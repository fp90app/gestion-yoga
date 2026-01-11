const functions = require("firebase-functions");
const admin = require("firebase-admin");
const fetch = require("node-fetch");

admin.initializeApp();
const db = admin.firestore();

const BREVO_API_KEY = require("./ma-cle");

exports.onPlaceLiberated = functions.region("europe-west1").firestore
    .document("attendance/{seanceId}")
    .onUpdate(async (change, context) => {
        const newData = change.after.data();
        const oldData = change.before.data();

        // 1. VÉRIFICATION DE BASE : Y a-t-il des gens à prévenir ?
        const waitingList = newData.waitingList || [];
        // Même si la liste d'attente est vide, on doit vérifier la logique "Surnombre" pour régulariser les remplacements
        // Donc on continue un peu plus loin.

        const groupeId = newData.groupeId;
        const dateSeance = newData.date;
        const seanceNom = newData.nomGroupe || "Cours";

        console.log(`🔍 [${seanceNom} ${dateSeance}] Analyse suite à modification...`);

        try {
            // ==================================================================
            // ÉTAPE 0 : LOGIQUE "SURNOMBRE" -> "REMPLAÇANT" (AVANT TOUT)
            // ==================================================================
            // Si un titulaire est absent et qu'il y a un "Invité" en trop (surnombre),
            // on assigne cet invité comme remplaçant du titulaire pour "combler le trou".
            // Cela évite d'envoyer un mail alors que le cours est en fait complet physiquement.
            
            const statusMap = newData.status || {};
            const replacementLinks = newData.replacementLinks || {};

            // A. Identifier les Titulaires Absents et "Libres" (non remplacés)
            // Pour cela, on a besoin de la liste des titulaires (inscrits au groupe)
            // On ne peut pas facilement l'avoir juste avec 'attendance', il faut aller chercher les élèves
            // qui ont ce groupeId. C'est un peu coûteux, mais nécessaire pour cette feature.
            
            // Note: Pour optimiser, on regarde juste qui est marqué "absent" dans attendance.
            // Si quelqu'un est dans status avec 'absent' ou 'absent_announced', c'est un titulaire (ou un inscrit permanent).
            const absentsIds = Object.keys(statusMap).filter(uid => 
                statusMap[uid] === 'absent' || statusMap[uid] === 'absent_announced'
            );

            // Parmi ces absents, lesquels ne sont PAS déjà cibles d'un remplacement ?
            const alreadyReplacedTitulaireIds = Object.values(replacementLinks);
            const absentsNonRemplaces = absentsIds.filter(tid => !alreadyReplacedTitulaireIds.includes(tid));

            // B. Identifier les "Surnombres" (Invités présents sans lien de remplacement)
            const presentsIds = Object.keys(statusMap).filter(uid => statusMap[uid] === 'present');
            
            // Un "Surnombre" est un présent qui n'est PAS titulaire (donc pas dans la liste des inscrits du groupe)
            // ET qui n'est pas déjà un remplaçant officiel.
            // Problème : on ne connaît pas la liste des titulaires ici sans requête DB.
            // ASTUCE : Si quelqu'un est présent ET qu'il n'est PAS une clé dans replacementLinks...
            // ...est-ce un surnombre ? Pas forcément, ça peut être un titulaire présent.
            
            // On doit faire une requête pour avoir les titulaires du groupe.
            let isAjout = false;
            let exceptionData = null;
            
            // Check si c'est une exception (Ajout) ou un cours normal
             const exceptionRef = await db.collection("exceptions").doc(groupeId).get();
             if (exceptionRef.exists && exceptionRef.data().type === 'ajout') {
                 isAjout = true;
                 exceptionData = exceptionRef.data();
             }

            let titulairesIds = [];
            if (!isAjout) {
                const titulairesSnap = await db.collection("eleves")
                    .where("enrolledGroupIds", "array-contains", groupeId)
                    .get();
                titulairesIds = titulairesSnap.docs.map(d => d.id);
            }

            // Maintenant on peut identifier les "Invités Surnombre"
            // Ce sont les présents qui ne sont PAS titulaires ET qui ne sont PAS dans replacementLinks (en tant que remplaçant)
            const guestsIds = presentsIds.filter(pid => !titulairesIds.includes(pid));
            const activeReplacers = Object.keys(replacementLinks); // Ceux qui remplacent déjà quelqu'un
            
            const surnombreGuests = guestsIds.filter(gid => !activeReplacers.includes(gid));

            // C. RÉSULTAT DU MATCHING
            if (absentsNonRemplaces.length > 0 && surnombreGuests.length > 0) {
                // On a un "trou" (absent non remplacé) et un "bouchon" (surnombre)
                // On fait le lien !
                const absentCible = absentsNonRemplaces[0];
                const remplacantElu = surnombreGuests[0];

                console.log(`⚡ AUTO-MATCHING : Le surnombre ${remplacantElu} remplace automatiquement l'absent ${absentCible}.`);

                // On met à jour la base de données
                await change.after.ref.update({
                    [`replacementLinks.${remplacantElu}`]: absentCible
                });

                // ET SURTOUT : ON ARRÊTE TOUT ICI.
                // Pas d'envoi de mail car la place est techniquement "prise" par le surnombre.
                console.log("🛑 Pas d'envoi d'email : La place libérée a été absorbée par le surnombre.");
                return null;
            }

            // ==================================================================
            // FIN LOGIQUE SURNOMBRE -> Si on est encore là, on continue normalement
            // ==================================================================

            if (waitingList.length === 0) return null;

            // ==================================================================
            // ÉTAPE 1 : CAPACITÉ OFFICIELLE (C)
            // ==================================================================
            let capacity = 0;

            if (isAjout) {
                capacity = parseInt(exceptionData?.newSessionData?.places || 0);
            } else {
                // B. Cours Récurrent
                const groupRef = await db.collection("groupes").doc(groupeId).get();
                if (!groupRef.exists) {
                    console.error("⚠️ Groupe introuvable en DB.");
                    return null;
                }
                capacity = parseInt(groupRef.data().places || 0);

                // C. Exception de date (Check si capacité modifiée ponctuellement)
                const exQuery = await db.collection("exceptions")
                    .where("groupeId", "==", groupeId)
                    .where("date", "==", dateSeance)
                    .get();

                if (!exQuery.empty) {
                    const exData = exQuery.docs[0].data();
                    if (exData.type === 'annulation') return null;
                    if (exData.newSessionData?.places !== undefined) {
                        capacity = parseInt(exData.newSessionData.places);
                    }
                }
            }

            // ==================================================================
            // ÉTAPE 2 : COMPTAGE PRÉCIS DES HUMAINS
            // ==================================================================

            // Fonction de comptage avec LOGS DÉTAILLÉS
            const countOccupants = (attendanceData, label) => {
                const sMap = attendanceData.status || {};
                let count = 0;

                if (isAjout) {
                    count = Object.values(sMap).filter(s => s === 'present').length;
                } else {
                    // 1. Titulaires (sauf absents)
                    titulairesIds.forEach(tid => {
                        const s = sMap[tid];
                        const isAbsent = (s === 'absent' || s === 'absent_announced');
                        if (!isAbsent) count++;
                    });

                    // 2. Invités (Présents non titulaires)
                    Object.keys(sMap).forEach(uid => {
                        if (sMap[uid] === 'present' && !titulairesIds.includes(uid)) {
                            count++;
                        }
                    });
                }
                return count;
            };

            const countBefore = countOccupants(oldData, "AVANT");
            const countAfter = countOccupants(newData, "APRÈS");

            console.log(`📊 Bilan Mathématique : Avant=${countBefore} -> Après=${countAfter} (Capacité=${capacity})`);

            // ==================================================================
            // ÉTAPE 3 : DÉCISION STRICTE
            // ==================================================================

            if (countBefore < capacity) {
                console.log("🛑 Le cours était DÉJÀ libre avant la modif. Pas de mail.");
                return null;
            }

            if (countAfter >= capacity) {
                console.log("🛑 Le cours est TOUJOURS complet. Pas de mail.");
                return null;
            }

            // Si on arrive ici, c'est que : AVANT >= CAPACITÉ  et  APRÈS < CAPACITÉ
            console.log("✅ DÉCLENCHEMENT : Une place vient vraiment de se libérer.");

            // ==================================================================
            // ÉTAPE 4 : ENVOI MAIL
            // ==================================================================
            const emails = [];
            for (const uid of waitingList) {
                const docEleve = await db.collection("eleves").doc(uid).get();
                if (docEleve.exists && docEleve.data().email) {
                    emails.push({ email: docEleve.data().email, name: docEleve.data().prenom });
                }
            }

            if (emails.length === 0) return null;

            const placesRestantes = capacity - countAfter;
            const [annee, mois, jour] = dateSeance.split("-");
            const dateFr = `${jour}/${mois}/${annee}`;

            const emailData = {
                sender: { name: "Yoga Sandrine", email: "putod.sandrine@gmail.com" },
                to: emails,
                subject: "Une place s'est libérée ! 🧘‍♀️",
                htmlContent: `
                    <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
                        <h2 style="color: #0d9488;">Une place vous attend !</h2>
                        
                        <p style="font-weight: bold; color: #c2410c;">Bonjour,</p>
                        <p style="font-weight: bold; color: #c2410c;">Une place vient de se libérer pour un cours où tu es noté(e) en attente :</p>
                        <div style="background-color: #f0fdfa; padding: 15px; border-left: 4px solid #0d9488; margin: 20px 0;">
                            <strong>${seanceNom}</strong><br>
                            Date : ${dateFr}<br>
                            <small>Places disponibles : ${placesRestantes}</small>
                        </div>
                        
                         <p style="font-weight: bold; color: #c2410c;">Si tu souhaites venir, pense à aller t'inscrire sur le planning !</p>
                        <p style="font-weight: bold; color: #c2410c;">Premier arrivé, premier servi.</p>
                        <div style="text-align: center; margin-top: 30px;">
                            <a href="https://gestion-yoga.pages.dev" style="background-color: #0d9488; color: white; padding: 12px 25px; text-decoration: none; border-radius: 8px; font-weight: bold;">
                                Réserver maintenant
                            </a>
                        </div>
                    </div>
                `
            };

            await fetch("https://api.brevo.com/v3/smtp/email", {
                method: "POST",
                headers: {
                    "accept": "application/json",
                    "api-key": BREVO_API_KEY,
                    "content-type": "application/json"
                },
                body: JSON.stringify(emailData)
            });
            console.log(`📨 Mails envoyés à ${emails.length} personnes.`);

        } catch (error) {
            console.error("❌ Erreur critique :", error);
        }

        return null;
    });