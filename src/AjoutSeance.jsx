import { useState, useEffect } from 'react';
import { db } from './firebase';
import { collection, addDoc, updateDoc, doc, deleteDoc } from 'firebase/firestore'; // Import deleteDoc

export default function AjoutSeance({ onClose, onSuccess, initialData }) {
    const [formData, setFormData] = useState({
        nom: 'Séance Exceptionnelle',
        date: '',
        heureDebut: '18:00',
        duree: 90,
        places: 10,
        theme: '',
        type: 'ajout'
    });

    useEffect(() => {
        if (initialData) {
            setFormData(prev => ({ ...prev, ...initialData }));
        }
    }, [initialData]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            const sessionData = {
                nom: formData.nom,
                heureDebut: formData.heureDebut,
                duree: parseInt(formData.duree),
                places: parseInt(formData.places),
                theme: formData.theme || ""
            };

            if (initialData && initialData.id) {
                const docId = initialData.originalExceptionId || initialData.id;
                await updateDoc(doc(db, "exceptions", docId), {
                    date: formData.date,
                    newSessionData: sessionData
                });
            }
            else {
                await addDoc(collection(db, "exceptions"), {
                    date: formData.date,
                    type: "ajout",
                    groupeId: "ajout_" + Date.now(),
                    newSessionData: sessionData
                });
            }

            onSuccess();
            onClose();
        } catch (error) {
            console.error("Erreur lors de l'enregistrement :", error);
            alert("Une erreur est survenue lors de l'enregistrement.");
        }
    };

    // --- FONCTION SUPPRESSION ---
    const handleDelete = async () => {
        if (!initialData || !initialData.id) return;

        if (confirm("⚠️ Voulez-vous vraiment SUPPRIMER définitivement cette séance ?\n\nCette action est irréversible.")) {
            try {
                const docId = initialData.originalExceptionId || initialData.id;
                await deleteDoc(doc(db, "exceptions", docId));
                onSuccess();
                onClose();
            } catch (error) {
                console.error("Erreur suppression:", error);
                alert("Erreur lors de la suppression.");
            }
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95">

                <div className="bg-purple-700 p-4 text-white flex justify-between items-center">
                    <h2 className="text-lg font-bold font-playfair flex items-center gap-2">
                        ✨ {initialData?.id ? "Modifier la Séance" : "Nouvelle Séance Unique"}
                    </h2>
                    <button onClick={onClose} className="bg-white/20 hover:bg-white/30 rounded-full w-8 h-8 flex items-center justify-center font-bold text-sm transition">✕</button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-gray-500 mb-1 uppercase">Nom de la séance</label>
                        <input
                            type="text"
                            placeholder="ex: Atelier Yoga du Dos"
                            value={formData.nom}
                            onChange={e => setFormData({ ...formData, nom: e.target.value })}
                            className="w-full border border-gray-300 p-2.5 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none font-bold text-gray-800"
                            required
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-gray-500 mb-1 uppercase">Thème / Description</label>
                        <textarea
                            placeholder="Décrivez le contenu de la séance (optionnel)..."
                            value={formData.theme}
                            onChange={e => setFormData({ ...formData, theme: e.target.value })}
                            className="w-full border border-gray-300 p-2.5 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none text-sm h-24 resize-none"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-gray-500 mb-1 uppercase">Date</label>
                            <input
                                type="date"
                                value={formData.date}
                                onChange={e => setFormData({ ...formData, date: e.target.value })}
                                className="w-full border border-gray-300 p-2 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-500 mb-1 uppercase">Heure Début</label>
                            <input
                                type="time"
                                value={formData.heureDebut}
                                onChange={e => setFormData({ ...formData, heureDebut: e.target.value })}
                                className="w-full border border-gray-300 p-2 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
                                required
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 bg-gray-50 p-3 rounded-xl border border-gray-100">
                        <div>
                            <label className="block text-xs font-bold text-gray-500 mb-1 uppercase">Durée (min)</label>
                            <input
                                type="number"
                                value={formData.duree}
                                onChange={e => setFormData({ ...formData, duree: e.target.value })}
                                className="w-full border border-gray-300 p-2 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none text-center font-bold"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-purple-600 mb-1 uppercase">Nb. Places</label>
                            <input
                                type="number"
                                value={formData.places}
                                onChange={e => setFormData({ ...formData, places: e.target.value })}
                                className="w-full border border-purple-200 bg-white p-2 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none text-center font-bold text-purple-800"
                            />
                        </div>
                    </div>

                    <div className="flex gap-3 pt-2">
                        {/* BOUTON SUPPRIMER (Seulement si modification) */}
                        {initialData?.id && (
                            <button
                                type="button"
                                onClick={handleDelete}
                                className="px-4 py-3 rounded-xl font-bold text-red-600 bg-red-50 border border-red-100 hover:bg-red-100 transition"
                                title="Supprimer définitivement"
                            >
                                🗑️
                            </button>
                        )}

                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 px-4 py-3 rounded-xl font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 transition"
                        >
                            Annuler
                        </button>
                        <button
                            type="submit"
                            className="flex-1 px-4 py-3 rounded-xl font-bold text-white bg-purple-600 hover:bg-purple-700 shadow-lg shadow-purple-200 transition transform active:scale-95"
                        >
                            Enregistrer
                        </button>
                    </div>

                </form>
            </div>
        </div>
    );
}