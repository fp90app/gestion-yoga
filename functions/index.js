const functions = require("firebase-functions");
const admin = require("firebase-admin");
const fetch = require("node-fetch"); // Si erreur, faire : npm install node-fetch@2

admin.initializeApp();

// Mettez votre Clé API Brevo ici
const BREVO_API_KEY = require("./ma-cle");

exports.onPlaceLiberated = functions.region("europe-west1").firestore
    .document("attendance/{seanceId}")
    .onUpdate(async (change, context) => {
        const newData = change.after.data();
        const oldData = change.before.data();

        // 1. Vérifier s'il y a du monde en attente
        const waitingList = newData.waitingList || [];
        if (waitingList.length === 0) return null;

        // 2. Vérifier si une place s'est libérée (Moins de présents qu'avant)
        const getCount = (data) => Object.values(data.status || {}).filter(s => s === 'present').length;
        if (getCount(newData) >= getCount(oldData)) return null;

        console.log(`Place libérée pour ${newData.nomGroupe}. Envoi mails...`);

        // 3. Récupérer les emails des élèves en attente
        const db = admin.firestore();
        const emails = [];

        for (const uid of waitingList) {
            const doc = await db.collection("eleves").doc(uid).get();
            if (doc.exists && doc.data().email) {
                emails.push({ email: doc.data().email, name: doc.data().prenom });
            }
        }

        if (emails.length === 0) return null;

        // 4. Envoyer l'email via l'API Brevo (Appel direct)
        const emailData = {
            sender: { name: "Yoga App", email: "putod.sandrine@gmail.com" }, // Votre email validé dans Brevo
            to: emails, // Brevo accepte une liste, tout le monde recevra le mail
            subject: "Une place s'est libérée !",
            htmlContent: `
            <h3>Bonjour !</h3>
            <p>Une place vient de se libérer pour le cours <strong>${newData.nomGroupe}</strong>.</p>
            <p>Date : ${newData.date}</p>
            <p>Premier arrivé, premier servi ! Connectez-vous vite pour réserver.</p>
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
            console.log("Emails envoyés via Brevo !");
        } catch (err) {
            console.error("Erreur Brevo:", err);
        }

        return null;
    });