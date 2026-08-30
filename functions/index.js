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

        // 1. VÉRIFICATION : Y a-t-il des gens à prévenir ?
        const waitingList = newData.waitingList || [];
        if (waitingList.length === 0) return null;

        const groupeId = newData.groupeId;
        const dateSeance = newData.date;
        const seanceNom = newData.nomGroupe || "Cours";

        console.log(`🔍 [${seanceNom} ${dateSeance}] Analyse suite à modification...`);

        try {
            // ==================================================================
            // ÉTAPE 1 : CAPACITÉ OFFICIELLE (C)
            // ==================================================================
            let capacity = 0;
            let isAjout = false;

            // A. Séance Unique (Ajout)
            const exceptionRef = await db.collection("exceptions").doc(groupeId).get();
            if (exceptionRef.exists && exceptionRef.data().type === 'ajout') {
                isAjout = true;
                capacity = parseInt(exceptionRef.data().newSessionData?.places || 0);
            } else {
                // B. Cours Récurrent
                const groupRef = await db.collection("groupes").doc(groupeId).get();
                if (!groupRef.exists) {
                    console.error("⚠️ Groupe introuvable en DB.");
                    return null;
                }
                capacity = parseInt(groupRef.data().places || 0);

                // C. Exception de date
                const exQuery = await db.collection("exceptions")
                    .where("groupeId", "==", groupeId)
                    .where("date", "==", dateSeance)
                    .get();

                if (!exQuery.empty) {
                    const exData = exQuery.docs[0].data();
                    if (exData.type === 'annulation') return null;
                    if (exData.newSessionData?.places !== undefined) {
                        capacity = parseInt(exData.newSessionData.places);
                        console.log(`ℹ️ Capacité modifiée exceptionnellement : ${capacity}`);
                    }
                }
            }

            // ==================================================================
            // ÉTAPE 2 : COMPTAGE PRÉCIS DES HUMAINS
            // ==================================================================

            // Récupération des titulaires (Inscrits à l'année)
            let titulairesIds = [];
            if (!isAjout) {
                const titulairesSnap = await db.collection("eleves")
                    .where("enrolledGroupIds", "array-contains", groupeId)
                    .get();
                titulairesIds = titulairesSnap.docs.map(d => d.id);
            }

            // Fonction de comptage avec LOGS DÉTAILLÉS
            const countOccupants = (attendanceData, label) => {
                const statusMap = attendanceData.status || {};
                let count = 0;
                let details = [];

                if (isAjout) {
                    count = Object.values(statusMap).filter(s => s === 'present').length;
                } else {
                    // 1. Titulaires
                    titulairesIds.forEach(tid => {
                        const s = statusMap[tid];
                        // Un titulaire compte SAUF s'il est marqué absent
                        const isAbsent = (s === 'absent' || s === 'absent_announced');
                        if (!isAbsent) {
                            count++;
                        } else {
                            // On note qui est absent pour le debug
                            details.push(`Titulaire Absent: ${tid}`);
                        }
                    });

                    // 2. Invités
                    Object.keys(statusMap).forEach(uid => {
                        if (statusMap[uid] === 'present' && !titulairesIds.includes(uid)) {
                            count++;
                            details.push(`Invité: ${uid}`);
                        }
                    });
                }

                // Afficher les détails s'il y a des absents/invités (pour comprendre le calcul)
                if (details.length > 0) console.log(`📋 Détails ${label}:`, details);
                return count;
            };

            const countBefore = countOccupants(oldData, "AVANT");
            const countAfter = countOccupants(newData, "APRÈS");

            console.log(`📊 Bilan Mathématique : Avant=${countBefore} -> Après=${countAfter} (Capacité=${capacity})`);

            // ==================================================================
            // ÉTAPE 3 : DÉCISION STRICTE
            // ==================================================================

            // Si c'était déjà libre avant, on ne fait rien (évite les doublons)
            if (countBefore < capacity) {
                console.log("🛑 Le cours était DÉJÀ libre avant la modif. Pas de mail.");
                return null;
            }

            // Si c'est TOUJOURS complet (ou surnombre), on ne fait rien
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
            // Formatage de la date : YYYY-MM-DD -> JJ/MM/AAAA
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