import { db } from './firebase';
import { collection, addDoc, getDocs, deleteDoc } from 'firebase/firestore';

const GROUPES_A_CREER = [
    { nom: 'Lundi Matin 1', jour: 1, heureDebut: '09:00', duree: 90 },
    { nom: 'Lundi Matin 2', jour: 1, heureDebut: '10:45', duree: 90 },
    { nom: 'Lundi Soir', jour: 1, heureDebut: '18:00', duree: 90 },
    { nom: 'Mardi Soir', jour: 2, heureDebut: '18:00', duree: 90 },
    { nom: 'Mercredi Matin 1', jour: 3, heureDebut: '09:00', duree: 90 },
    { nom: 'Mercredi Matin 2', jour: 3, heureDebut: '10:45', duree: 90 },
    { nom: 'Mercredi Soir', jour: 3, heureDebut: '17:15', duree: 90 },
    { nom: 'Jeudi Matin', jour: 4, heureDebut: '09:00', duree: 90 },
    { nom: 'Vendredi Soir 1', jour: 5, heureDebut: '17:00', duree: 90 },
    { nom: 'Vendredi Soir 2', jour: 5, heureDebut: '18:45', duree: 90 },
];

export const seedGroups = async () => {
    if (!confirm("Attention : Cela va réinitialiser tous les groupes à 7 places. Continuer ?")) return;

    try {
        const querySnapshot = await getDocs(collection(db, "groupes"));
        const deletePromises = querySnapshot.docs.map(doc => deleteDoc(doc.ref));
        await Promise.all(deletePromises);

        for (const groupe of GROUPES_A_CREER) {
            await addDoc(collection(db, "groupes"), {
                ...groupe,
                places: 7, // <--- C'est ici qu'on a changé
                actif: true
            });
        }

        alert("✅ Groupes réinitialisés avec 7 places !");
        window.location.reload();
    } catch (error) {
        console.error("Erreur:", error);
    }
};