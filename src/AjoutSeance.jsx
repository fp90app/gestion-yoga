import { useState, useEffect } from 'react';
import { db } from './firebase';
import { doc, setDoc, updateDoc } from 'firebase/firestore';

export default function AjoutSeance({ onClose, onSuccess, initialData = null }) {
    const [formData, setFormData] = useState({
        date: '',
        heure: '10:00',
        nom: 'Atelier Yoga',
        duree: 90,
        places: 7
    });

    useEffect(() => {
        if (initialData) {
            // Mode Modification : on pré-remplit
            // initialData contient : { dateReelle (Date), heureDebut, nom, duree, places, originalExceptionId, ... }
            const dateIso = initialData.dateReelle.toLocaleDateString('fr-CA'); // YYYY-MM-DD
            setFormData({
                date: dateIso,
                heure: initialData.heureDebut,
                nom: initialData.nom,
                duree: initialData.duree,
                places: initialData.places
            });
        } else {
            // Mode Création : date de demain par défaut
            const demain = new Date();
            demain.setDate(demain.getDate() + 1);
            setFormData(prev => ({ ...prev, date: demain.toISOString().split('T')[0] }));
        }
    }, [initialData]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            const dataToSave = {
                date: formData.date, // Sert de clé de tri et d'affichage
                type: "ajout",
                newSessionData: {
                    nom: formData.nom,
                    heureDebut: formData.heure,
                    duree: parseInt(formData.duree),
                    places: parseInt(formData.places),
                    jour: new Date(formData.date).getDay()
                }
            };

            if (initialData && initialData.originalExceptionId) {
                // UPDATE
                await updateDoc(doc(db, "exceptions", initialData.originalExceptionId), dataToSave);
                alert("Séance modifiée !");
            } else {
                // CREATE
                const cleanNom = formData.nom.replace(/\s+/g, '');
                const exceptionId = `${formData.date}_${cleanNom}_ADD_${Date.now()}`; // Ajout Timestamp pour unicité
                await setDoc(doc(db, "exceptions", exceptionId), dataToSave);
                alert("Séance ajoutée !");
            }

            onSuccess();
            onClose();
        } catch (error) {
            console.error(error);
            alert("Erreur lors de la sauvegarde");
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
                <div className="bg-teal-800 p-4 text-white flex justify-between items-center">
                    <h2 className="text-xl font-bold">{initialData ? "Modifier la séance" : "Ajouter une séance"}</h2>
                    <button onClick={onClose} className="text-white hover:text-gray-200 text-xl font-bold px-2">✕</button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">Date</label>
                        <input type="date" required value={formData.date} onChange={e => setFormData({ ...formData, date: e.target.value })} className="w-full border p-2 rounded focus:ring-2 focus:ring-teal-500 outline-none" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-bold text-gray-700 mb-1">Heure</label>
                            <input type="time" required value={formData.heure} onChange={e => setFormData({ ...formData, heure: e.target.value })} className="w-full border p-2 rounded focus:ring-2 focus:ring-teal-500 outline-none" />
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-gray-700 mb-1">Durée (min)</label>
                            <input type="number" required value={formData.duree} onChange={e => setFormData({ ...formData, duree: e.target.value })} className="w-full border p-2 rounded focus:ring-2 focus:ring-teal-500 outline-none" />
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">Nom</label>
                        <input type="text" required placeholder="Ex: Stage" value={formData.nom} onChange={e => setFormData({ ...formData, nom: e.target.value })} className="w-full border p-2 rounded focus:ring-2 focus:ring-teal-500 outline-none" />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">Places</label>
                        <input type="number" required value={formData.places} onChange={e => setFormData({ ...formData, places: e.target.value })} className="w-full border p-2 rounded focus:ring-2 focus:ring-teal-500 outline-none" />
                    </div>
                    <div className="pt-4 flex justify-end gap-3">
                        <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg font-bold text-gray-500 hover:bg-gray-100 border">Annuler</button>
                        <button type="submit" className="px-6 py-2 rounded-lg font-bold text-white bg-teal-800 hover:bg-teal-900 shadow-md transition">
                            {initialData ? "Enregistrer" : "Ajouter"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}