const functions = require("firebase-functions");
const admin = require("firebase-admin");
const fetch = require("node-fetch");

admin.initializeApp();

const BREVO_API_KEY = require("./ma-cle");

exports.onPlaceLiberated = functions.region("europe-west1").firestore
    .document("attendance/{seanceId}")
    .onUpdate(async (change, context) => {
        const newData = change.after.data();
        const oldData = change.before.data();
        const db = admin.firestore();

        // -----------------------------------------------------------
        // 1. FILTRAGE DE BASE
        // -----------------------------------------------------------

        // S'il n'y a personne en attente, inutile d'aller plus loin
        const waitingList = newData.waitingList || [];
        if (waitingList.length === 0) return null;

        // Calcul du nombre de présents (statut "present")
        const getCount = (data) => Object.values(data.status || {}).filter(s => s === 'present').length;
        const newCount = getCount(newData);
        const oldCount = getCount(oldData);

        // Si le nombre d'élèves n'a pas baissé, on n'envoie rien.
        // CELA GÈRE TON CAS DE "RÉDUCTION DE CAPACITÉ" : 
        // Si tu changes la capacité, 'newCount' reste égal à 'oldCount', donc ça s'arrête ici.
        if (newCount >= oldCount) return null;

        console.log(`Mouvement détecté : ${oldCount} -> ${newCount} élèves.`);

        // -----------------------------------------------------------
        // 2. VÉRIFICATIONS AVANCÉES (CAPACITÉ & ANNULATION)
        // -----------------------------------------------------------

        try {
            // A. Récupérer la capacité du groupe
            // On gère le cas des "ajouts" (séances uniques) et des groupes normaux
            let capacity = 10; // Sécurité par défaut
            let isCancelled = false;

            // Si c'est un groupe standard (l'ID ne commence pas par "ajout_")
            if (!newData.groupeId.startsWith("ajout_")) {
                const groupeDoc = await db.collection("groupes").doc(newData.groupeId).get();
                if (groupeDoc.exists) {
                    capacity = groupeDoc.data().places || 10;
                }

                // B. Vérifier si le cours est ANNULÉ ce jour-là
                // On cherche une exception de type "annulation" pour ce groupe et cette date
                const exceptionsQuery = await db.collection("exceptions")
                    .where("groupeId", "==", newData.groupeId)
                    .where("date", "==", newData.date) // Format YYYY-MM-DD stocké dans attendance
                    .where("type", "==", "annulation")
                    .get();

                if (!exceptionsQuery.empty) isCancelled = true;
            } else {
                // C'est une séance unique (ajout), la capacité est souvent dans l'ID ou stockée ailleurs
                // Pour simplifier ici, on considère que si c'est un ajout, on vérifie juste les places
                // Note : Tu devrais stocker 'places' dans le document attendance pour faciliter ça !
            }

            // CRITÈRE D'ARRÊT 1 : Le cours est annulé
            if (isCancelled) {
                console.log("ALERTE STOPPÉE : Le cours est marqué comme annulé.");
                return null;
            }

            // CRITÈRE D'ARRÊT 2 : Le cours est toujours complet (Surbooking résorbé mais pas de place vide)
            if (newCount >= capacity) {
                console.log(`ALERTE STOPPÉE : Cours toujours complet malgré le désistement (${newCount}/${capacity}).`);
                return null;
            }

        } catch (error) {
            console.error("Erreur lors des vérifications de sécurité :", error);
            return null; // En cas d'erreur technique, mieux vaut ne pas spammer
        }

        // -----------------------------------------------------------
        // 3. ENVOI DES EMAILS
        // -----------------------------------------------------------

        console.log(`✅ Place confirmée libre (${newCount} présents pour ${capacity} places). Envoi aux ${waitingList.length} personnes.`);

        const emails = [];
        for (const uid of waitingList) {
            const docEleve = await db.collection("eleves").doc(uid).get();
            if (docEleve.exists && docEleve.data().email) {
                emails.push({ email: docEleve.data().email, name: docEleve.data().prenom });
            }
        }

        if (emails.length === 0) return null;

        // Préparation Mail Brevo
        const emailData = {
            sender: { name: "Yoga Sandrine", email: "putod.sandrine@gmail.com" }, // Ton email validé
            to: emails,
            subject: "Une place s'est libérée ! 🧘‍♀️",
            htmlContent: `
                <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #0d9488;">Une place vous attend !</h2>
                    <p>Bonjour,</p>
                    <p>Suite à un désistement, une place vient de se libérer pour le cours :</p>
                    <div style="background-color: #f0fdfa; padding: 15px; border-left: 4px solid #0d9488; margin: 20px 0;">
                        <strong>${newData.nomGroupe}</strong><br>
                        Date : ${newData.date}
                    </div>
                    <p>Les personnes sur liste d'attente sont prévenues en même temps.</p>
                    <p style="font-weight: bold;">Premier arrivé, premier servi !</p>
                    <div style="text-align: center; margin-top: 30px;">
                        <a href="https://ton-site-yoga.web.app" style="background-color: #0d9488; color: white; padding: 12px 25px; text-decoration: none; border-radius: 8px; font-weight: bold;">
                            Réserver ma place maintenant
                        </a>
                    </div>
                </div>
            `
        };

        try {
            await fetch("https://api.brevo.com/v3/smtp/email", {
                method: "POST",
                headers: {
                    "accept": "application/json",
                    "api-key": BREVO_API_KEY,
                    "content-type": "application/json"
                },
                body: JSON.stringify(emailData)
            });
            console.log("Emails envoyés avec succès !");
        } catch (err) {
            console.error("Erreur API Brevo:", err);
        }

        return null;
    });