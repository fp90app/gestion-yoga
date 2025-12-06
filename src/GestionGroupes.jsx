import { useState, useEffect } from 'react';
import { db } from './firebase';
import { collection, addDoc, getDocs, updateDoc, doc, query, where, Timestamp } from 'firebase/firestore';

const JOURS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];

export default function GestionGroupes({ onClose, onUpdate, initialEditId }) {
    const [groupes, setGroupes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editingId, setEditingId] = useState(null);

    // --- LOGIQUE DATES PAR DÉFAUT ---
    // Calcule automatiquement une saison "Septembre -> Juin"
    const getDefaultDates = () => {
        const now = new Date();
        // Si on est après juin, c'est la rentrée de cette année, sinon c'est celle de l'année d'avant
        const year = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
        return {
            start: `${year}-09-01`,
            end: `${year + 1}-06-30`
        };
    };

    const [formData, setFormData] = useState({
        nom: '',
        jour: 1, // Lundi par défaut
        heureDebut: '18:00',
        duree: 60,
        places: 10,
        actif: true,
        dateDebut: getDefaultDates().start, // NOUVEAU
        dateFin: getDefaultDates().end      // NOUVEAU
    });

    useEffect(() => {
        fetchGroupes();
    }, []);

    useEffect(() => {
        if (initialEditId && groupes.length > 0) {
            const groupToEdit = groupes.find(g => g.id === initialEditId);
            if (groupToEdit) {
                handleEdit(groupToEdit);
            }
        }
    }, [initialEditId, groupes]);


    const fetchGroupes = async () => {
        try {
            const q = query(collection(db, "groupes"), where("actif", "==", true));
            const snap = await getDocs(q);

            const data = snap.docs.map(d => {
                const g = d.data();

                // --- MIGRATION À LA VOLÉE ---
                // Si le groupe n'a pas de dates (vieux groupe), on met des dates par défaut pour l'affichage
                let startVal = getDefaultDates().start;
                let endVal = '2030-01-01'; // Date lointaine pour les anciens groupes "infinis"

                if (g.dateDebut && g.dateDebut.toDate) {
                    startVal = g.dateDebut.toDate().toISOString().split('T')[0];
                }
                if (g.dateFin && g.dateFin.toDate) {
                    endVal = g.dateFin.toDate().toISOString().split('T')[0];
                }

                return {
                    id: d.id,
                    ...g,
                    dateDebut: startVal,
                    dateFin: endVal
                };
            });

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
        setFormData({
            nom: '', jour: 1, heureDebut: '18:00', duree: 60, places: 10, actif: true,
            dateDebut: getDefaultDates().start,
            dateFin: getDefaultDates().end
        });
        setEditingId(null);
    };

    const handleEdit = (groupe) => {
        setEditingId(groupe.id);
        setFormData({ ...groupe }); // Les dates sont déjà au bon format string grâce au fetch
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            // Conversion des dates String -> Timestamp Firestore
            const startTs = Timestamp.fromDate(new Date(formData.dateDebut));
            const endTs = Timestamp.fromDate(new Date(formData.dateFin));

            const dataToSave = {
                nom: formData.nom,
                jour: parseInt(formData.jour),
                heureDebut: formData.heureDebut,
                duree: parseInt(formData.duree),
                places: parseInt(formData.places),
                actif: true,
                dateDebut: startTs, // NOUVEAU CHAMP
                dateFin: endTs      // NOUVEAU CHAMP
            };

            if (editingId) {
                await updateDoc(doc(db, "groupes", editingId), dataToSave);
                alert("Cours mis à jour avec les nouvelles dates !");
            } else {
                await addDoc(collection(db, "groupes"), dataToSave);
                alert("Nouveau cours créé (avec saisonnalité) !");
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
        if (confirm(`Voulez-vous supprimer (archiver) le cours "${nom}" ?`)) {
            try {
                await updateDoc(doc(db, "groupes", id), { actif: false });
                fetchGroupes();
                if (onUpdate) onUpdate();
            } catch (error) {
                console.error(error);
            }
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl overflow-hidden flex flex-col max-h-[90vh]">

                {/* HEADER */}
                <div className="bg-teal-800 p-6 text-white flex justify-between items-center">
                    <div>
                        <h2 className="text-2xl font-bold font-playfair">Gestion des Cours</h2>
                        <p className="text-teal-200 text-sm">Définissez les créneaux et leurs périodes d'activité.</p>
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

                            {/* --- NOUVEAUX CHAMPS DATES --- */}
                            <div className="bg-teal-50 p-3 rounded-lg border border-teal-100">
                                <label className="block text-xs font-bold text-teal-800 mb-2 uppercase tracking-wide">📅 Période (Saison)</label>
                                <div className="space-y-3">
                                    <div>
                                        <div className="flex justify-between items-baseline mb-1">
                                            <span className="text-[10px] text-gray-500 uppercase font-bold">Début</span>
                                            <span className="text-[10px] text-gray-400 italic">1er cours</span>
                                        </div>
                                        <input type="date" required value={formData.dateDebut} onChange={e => setFormData({ ...formData, dateDebut: e.target.value })} className="w-full border p-1 rounded text-sm bg-white" />
                                    </div>
                                    <div>
                                        <div className="flex justify-between items-baseline mb-1">
                                            <span className="text-[10px] text-gray-500 uppercase font-bold">Fin</span>
                                            <span className="text-[10px] text-gray-400 italic">Dernier cours</span>
                                        </div>
                                        <input type="date" required value={formData.dateFin} onChange={e => setFormData({ ...formData, dateFin: e.target.value })} className="w-full border p-1 rounded text-sm bg-white" />
                                    </div>
                                </div>
                            </div>
                            {/* ----------------------------- */}

                            <div className="flex gap-2">
                                <div className="flex-1">
                                    <label className="block text-xs font-bold text-gray-500 mb-1">Jour</label>
                                    <select value={formData.jour} onChange={e => setFormData({ ...formData, jour: e.target.value })} className="w-full border p-2 rounded focus:ring-2 focus:ring-teal-500 outline-none">
                                        {JOURS.map((j, index) => <option key={index} value={index}>{j}</option>)}
                                    </select>
                                </div>
                                <div className="flex-1">
                                    <label className="block text-xs font-bold text-gray-500 mb-1">Heure</label>
                                    <input type="time" required value={formData.heureDebut} onChange={e => setFormData({ ...formData, heureDebut: e.target.value })} className="w-full border p-2 rounded focus:ring-2 focus:ring-teal-500 outline-none" />
                                </div>
                            </div>

                            <div className="flex gap-2">
                                <div className="flex-1">
                                    <label className="block text-xs font-bold text-gray-500 mb-1">Durée (min)</label>
                                    <input type="number" required value={formData.duree} onChange={e => setFormData({ ...formData, duree: e.target.value })} className="w-full border p-2 rounded focus:ring-2 focus:ring-teal-500 outline-none" />
                                </div>
                                <div className="flex-1">
                                    <label className="block text-xs font-bold text-gray-500 mb-1">Places</label>
                                    <input type="number" required value={formData.places} onChange={e => setFormData({ ...formData, places: e.target.value })} className="w-full border p-2 rounded focus:ring-2 focus:ring-teal-500 outline-none" />
                                </div>
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
                                        <h4 className="font-bold text-gray-800 flex items-center gap-2">
                                            {g.nom}
                                        </h4>
                                        <div className="text-sm text-gray-500 flex flex-wrap gap-x-2 items-center mt-1">
                                            <span className="font-semibold text-teal-600 uppercase text-xs">{JOURS[g.jour]}</span>
                                            <span className="text-gray-300">•</span>

                                            {/* Affichage visuel des dates */}
                                            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded border border-gray-200">
                                                {new Date(g.dateDebut).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                                                {' ➜ '}
                                                {new Date(g.dateFin).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                                            </span>

                                            <span className="text-gray-300 hidden md:inline">•</span>
                                            <span className="hidden md:inline">{g.places} pl.</span>
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