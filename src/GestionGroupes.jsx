import { useState, useEffect } from 'react';
import { db } from './firebase';
import { collection, addDoc, getDocs, updateDoc, doc, query, where, orderBy } from 'firebase/firestore';

const JOURS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];

export default function GestionGroupes({ onClose, onUpdate }) {
    const [groupes, setGroupes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editingId, setEditingId] = useState(null);

    // État du formulaire
    const [formData, setFormData] = useState({
        nom: '',
        jour: 1, // Lundi par défaut
        heureDebut: '18:00',
        duree: 60,
        places: 10,
        actif: true
    });

    useEffect(() => {
        fetchGroupes();
    }, []);

    const fetchGroupes = async () => {
        try {
            // On récupère tout, même les inactifs pour pouvoir les réactiver si besoin (optionnel)
            // Ici on filtre sur actif=true pour l'affichage principal, ou on trie.
            const q = query(collection(db, "groupes"), where("actif", "==", true));
            const snap = await getDocs(q);
            const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));

            // Tri par Jour puis par Heure
            data.sort((a, b) => (a.jour - b.jour) || a.heureDebut.localeCompare(b.heureDebut));
            setGroupes(data);
        } catch (error) {
            console.error("Erreur fetch groupes:", error);
        } finally {
            setLoading(false);
        }
    };

    const resetForm = () => {
        setFormData({ nom: '', jour: 1, heureDebut: '18:00', duree: 60, places: 10, actif: true });
        setEditingId(null);
    };

    const handleEdit = (groupe) => {
        setEditingId(groupe.id);
        setFormData({ ...groupe });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            const dataToSave = {
                nom: formData.nom,
                jour: parseInt(formData.jour),
                heureDebut: formData.heureDebut,
                duree: parseInt(formData.duree),
                places: parseInt(formData.places),
                actif: true
            };

            if (editingId) {
                // UPDATE
                await updateDoc(doc(db, "groupes", editingId), dataToSave);
                alert("Cours modifié avec succès !");
            } else {
                // CREATE
                await addDoc(collection(db, "groupes"), dataToSave);
                alert("Nouveau cours récurrent créé !");
            }

            resetForm();
            fetchGroupes();
            if (onUpdate) onUpdate(); // Rafraîchir le planning derrière
        } catch (error) {
            console.error(error);
            alert("Erreur lors de la sauvegarde");
        }
    };

    const handleArchive = async (id, nom) => {
        if (confirm(`Voulez-vous supprimer le cours récurrent "${nom}" ?\nCela n'effacera pas l'historique, mais il n'apparaîtra plus sur le planning futur.`)) {
            try {
                await updateDoc(doc(db, "groupes", id), { actif: false });
                fetchGroupes();
                if (onUpdate) onUpdate();
            } catch (error) {
                console.error(error);
                alert("Erreur suppression");
            }
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]">

                {/* HEADER */}
                <div className="bg-teal-800 p-6 text-white flex justify-between items-center">
                    <div>
                        <h2 className="text-2xl font-bold font-playfair">Gestion des Cours Récurrents</h2>
                        <p className="text-teal-200 text-sm">Ces cours s'affichent automatiquement chaque semaine.</p>
                    </div>
                    <button onClick={onClose} className="text-white hover:text-gray-200 text-2xl font-bold">✕</button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 bg-gray-50 flex flex-col md:flex-row gap-6">

                    {/* COLONNE GAUCHE : FORMULAIRE */}
                    <div className="md:w-1/3 bg-white p-6 rounded-xl shadow-sm border border-gray-100 h-fit">
                        <h3 className="font-bold text-lg text-teal-800 mb-4 border-b pb-2">
                            {editingId ? "Modifier le cours" : "Créer un cours"}
                        </h3>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-gray-500 mb-1">Nom du cours</label>
                                <input type="text" required value={formData.nom} onChange={e => setFormData({ ...formData, nom: e.target.value })} className="w-full border p-2 rounded focus:ring-2 focus:ring-teal-500 outline-none" placeholder="ex: Hatha Yoga" />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-gray-500 mb-1">Jour de la semaine</label>
                                <select value={formData.jour} onChange={e => setFormData({ ...formData, jour: e.target.value })} className="w-full border p-2 rounded focus:ring-2 focus:ring-teal-500 outline-none">
                                    {JOURS.map((j, index) => <option key={index} value={index}>{j}</option>)}
                                </select>
                            </div>

                            <div className="flex gap-2">
                                <div className="flex-1">
                                    <label className="block text-xs font-bold text-gray-500 mb-1">Heure Début</label>
                                    <input type="time" required value={formData.heureDebut} onChange={e => setFormData({ ...formData, heureDebut: e.target.value })} className="w-full border p-2 rounded focus:ring-2 focus:ring-teal-500 outline-none" />
                                </div>
                                <div className="flex-1">
                                    <label className="block text-xs font-bold text-gray-500 mb-1">Durée (min)</label>
                                    <input type="number" required value={formData.duree} onChange={e => setFormData({ ...formData, duree: e.target.value })} className="w-full border p-2 rounded focus:ring-2 focus:ring-teal-500 outline-none" />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-gray-500 mb-1">Capacité (Places)</label>
                                <input type="number" required value={formData.places} onChange={e => setFormData({ ...formData, places: e.target.value })} className="w-full border p-2 rounded focus:ring-2 focus:ring-teal-500 outline-none" />
                            </div>

                            <div className="pt-2 flex gap-2">
                                {editingId && (
                                    <button type="button" onClick={resetForm} className="flex-1 px-4 py-2 rounded-lg font-bold text-gray-500 bg-gray-100 hover:bg-gray-200">Annuler</button>
                                )}
                                <button type="submit" className="flex-1 px-4 py-2 rounded-lg font-bold text-white bg-teal-600 hover:bg-teal-700 shadow-md">
                                    {editingId ? "Mettre à jour" : "Ajouter"}
                                </button>
                            </div>
                        </form>
                    </div>

                    {/* COLONNE DROITE : LISTE */}
                    <div className="md:w-2/3 space-y-3">
                        {loading && <p>Chargement...</p>}
                        {!loading && groupes.length === 0 && <p className="text-gray-500 italic">Aucun cours récurrent configuré.</p>}

                        {groupes.map(g => (
                            <div key={g.id} className={`bg-white p-4 rounded-xl border border-gray-100 shadow-sm flex justify-between items-center transition ${editingId === g.id ? 'ring-2 ring-teal-500 bg-teal-50' : 'hover:shadow-md'}`}>
                                <div className="flex items-center gap-4">
                                    <div className="bg-teal-100 text-teal-800 font-bold w-12 h-12 rounded-lg flex flex-col items-center justify-center text-xs leading-tight">
                                        <span className="text-lg">{g.heureDebut.split(':')[0]}</span>
                                        <span>{g.heureDebut.split(':')[1]}</span>
                                    </div>
                                    <div>
                                        <h4 className="font-bold text-gray-800">{g.nom}</h4>
                                        <div className="text-sm text-gray-500 flex gap-2">
                                            <span className="font-semibold text-teal-600">{JOURS[g.jour]}</span>
                                            <span>•</span>
                                            <span>{g.duree} min</span>
                                            <span>•</span>
                                            <span>{g.places} places</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    <button onClick={() => handleEdit(g)} className="p-2 text-blue-600 hover:bg-blue-50 rounded-full transition" title="Modifier">
                                        ✏️
                                    </button>
                                    <button onClick={() => handleArchive(g.id, g.nom)} className="p-2 text-red-600 hover:bg-red-50 rounded-full transition" title="Supprimer (Archiver)">
                                        🗑️
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}