import { useState, useEffect } from 'react';
import { db } from './firebase';
import { collection, addDoc, getDocs, updateDoc, deleteDoc, doc, orderBy, query, serverTimestamp } from 'firebase/firestore';
import toast from 'react-hot-toast';
import ConfirmModal from './components/ConfirmModal'; // <--- IMPORT MODALE

export default function Annuaire() {
    const [eleves, setEleves] = useState([]);
    const [groupes, setGroupes] = useState([]);
    const [loading, setLoading] = useState(true);

    // Recherche
    const [searchTerm, setSearchTerm] = useState("");

    // Édition
    const [editCredits, setEditCredits] = useState(0);
    const [formData, setFormData] = useState({ nom: '', prenom: '', email: '' });
    const [eleveEnEdition, setEleveEnEdition] = useState(null);

    // Modale de confirmation
    const [confirmConfig, setConfirmConfig] = useState(null);

    useEffect(() => { fetchData(); }, []);

    const fetchData = async () => {
        try {
            setLoading(true);
            // 1. Élèves
            const qEleves = query(collection(db, "eleves"), orderBy("nom"));
            const snapshotEleves = await getDocs(qEleves);
            setEleves(snapshotEleves.docs.map(doc => ({ id: doc.id, ...doc.data() })));

            // 2. Groupes (pour les affectations)
            const snapshotGroupes = await getDocs(collection(db, "groupes"));
            const dataGroupes = snapshotGroupes.docs.map(doc => {
                const d = doc.data();
                const debut = d.dateDebut?.toDate ? d.dateDebut.toDate() : new Date('2024-01-01');
                const fin = d.dateFin?.toDate ? d.dateFin.toDate() : new Date('2030-01-01');
                return { id: doc.id, ...d, _debut: debut, _fin: fin };
            });

            // Tri : Actifs d'abord
            dataGroupes.sort((a, b) => {
                const now = new Date();
                const aIsActive = a._fin >= now;
                const bIsActive = b._fin >= now;
                if (aIsActive && !bIsActive) return -1;
                if (!aIsActive && bIsActive) return 1;
                return (a.jour - b.jour) || a.heureDebut.localeCompare(b.heureDebut);
            });

            setGroupes(dataGroupes);
        } catch (error) {
            console.error(error);
            toast.error("Erreur de chargement");
        } finally {
            setLoading(false);
        }
    };

    const isGroupActive = (groupe) => {
        if (!groupe) return false;
        return groupe._fin >= new Date();
    };

    // --- ACTIONS ---

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!formData.nom || !formData.prenom) return;

        const toastId = toast.loading("Création...");
        try {
            await addDoc(collection(db, "eleves"), {
                nom: formData.nom.toUpperCase(),
                prenom: formData.prenom,
                email: formData.email.trim().toLowerCase(),
                role: "student",
                absARemplacer: 0,
                enrolledGroupIds: []
            });
            setFormData({ nom: '', prenom: '', email: '' });
            fetchData();
            toast.success("Élève créé avec succès !", { id: toastId });
        } catch (error) {
            console.error(error);
            toast.error("Erreur lors de la création", { id: toastId });
        }
    };

    const demanderSuppression = (id, nomComplet) => {
        setConfirmConfig({
            title: "Supprimer l'élève ?",
            content: <p>Êtes-vous sûr de vouloir supprimer définitivement <strong>{nomComplet}</strong> ?<br /><span className="text-xs text-red-500">Cette action est irréversible.</span></p>,
            confirmLabel: "Supprimer définitivement",
            colorClass: "bg-red-600",
            onConfirm: async () => {
                try {
                    await deleteDoc(doc(db, "eleves", id));
                    setEleves(prev => prev.filter(e => e.id !== id));
                    toast.success("Élève supprimé.");
                    setConfirmConfig(null);
                } catch (error) {
                    console.error(error);
                    toast.error("Erreur suppression");
                }
            }
        });
    };

    const openEditModal = (eleve) => {
        setEleveEnEdition(eleve);
        setEditCredits(eleve.absARemplacer || 0);
    };

    const toggleGroupePourEleve = (groupeId) => {
        if (!eleveEnEdition) return;
        const currentGroups = eleveEnEdition.enrolledGroupIds || [];
        let newGroups;
        if (currentGroups.includes(groupeId)) {
            newGroups = currentGroups.filter(id => id !== groupeId);
        } else {
            newGroups = [...currentGroups, groupeId];
        }
        setEleveEnEdition({ ...eleveEnEdition, enrolledGroupIds: newGroups });
    };

    const sauvegarderEdition = async () => {
        const toastId = toast.loading("Sauvegarde...");
        try {
            const userRef = doc(db, "eleves", eleveEnEdition.id);
            const nouveauxCredits = parseInt(editCredits);
            const anciensCredits = eleveEnEdition.absARemplacer || 0;
            const delta = nouveauxCredits - anciensCredits;

            // 1. Mise à jour Profil
            await updateDoc(userRef, {
                nom: eleveEnEdition.nom.toUpperCase(),
                prenom: eleveEnEdition.prenom,
                email: eleveEnEdition.email.trim().toLowerCase(),
                enrolledGroupIds: eleveEnEdition.enrolledGroupIds,
                absARemplacer: nouveauxCredits
            });

            // 2. Historique si changement de crédits
            if (delta !== 0) {
                await addDoc(collection(db, "eleves", eleveEnEdition.id, "history"), {
                    date: serverTimestamp(),
                    delta: delta,
                    motif: "Régularisation Admin",
                    seanceId: "admin_manual",
                    groupeNom: "-",
                    seanceDate: new Date().toLocaleDateString('fr-FR')
                });
            }

            toast.success("Modifications enregistrées !", { id: toastId });
            setEleveEnEdition(null);
            fetchData();
        } catch (error) {
            console.error(error);
            toast.error("Erreur lors de la sauvegarde", { id: toastId });
        }
    };

    // Filtrage recherche
    const filteredEleves = eleves.filter(e =>
        e.nom.toLowerCase().includes(searchTerm.toLowerCase()) ||
        e.prenom.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const JOURS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

    return (
        <div className="max-w-6xl mx-auto p-4 relative">
            <ConfirmModal
                isOpen={!!confirmConfig}
                title={confirmConfig?.title}
                confirmLabel={confirmConfig?.confirmLabel}
                colorClass={confirmConfig?.colorClass}
                onConfirm={confirmConfig?.onConfirm}
                onCancel={() => setConfirmConfig(null)}
            >
                {confirmConfig?.content}
            </ConfirmModal>

            <div className="flex flex-col md:flex-row justify-between items-end md:items-center mb-6 border-b pb-4 gap-4">
                <h2 className="text-3xl font-playfair font-bold text-gray-800">
                    Gestion des Élèves 👥
                </h2>

                {/* BARRE DE RECHERCHE */}
                <div className="relative w-full md:w-64">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
                    <input
                        type="text"
                        placeholder="Rechercher un nom..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-full focus:ring-2 focus:ring-teal-500 outline-none text-sm"
                    />
                </div>
            </div>

            {/* FORMULAIRE AJOUT */}
            <div className="bg-white p-6 rounded-xl shadow-md mb-8 border border-gray-100">
                <h3 className="font-bold text-lg mb-4 text-teal-700">Inscrire un nouvel élève</h3>
                <form onSubmit={handleSubmit} className="flex flex-col md:flex-row gap-4 items-end">
                    <div className="flex-1 w-full">
                        <label className="text-xs font-bold text-gray-500 mb-1 block">NOM</label>
                        <input type="text" placeholder="ex: DUPONT" value={formData.nom} onChange={e => setFormData({ ...formData, nom: e.target.value })} className="w-full border p-2 rounded uppercase focus:ring-2 focus:ring-teal-500 outline-none" required />
                    </div>
                    <div className="flex-1 w-full">
                        <label className="text-xs font-bold text-gray-500 mb-1 block">Prénom</label>
                        <input type="text" placeholder="ex: Marie" value={formData.prenom} onChange={e => setFormData({ ...formData, prenom: e.target.value })} className="w-full border p-2 rounded focus:ring-2 focus:ring-teal-500 outline-none" required />
                    </div>
                    <div className="flex-1 w-full">
                        <label className="text-xs font-bold text-gray-500 mb-1 block">Email</label>
                        <input type="email" placeholder="marie@mail.com" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} className="w-full border p-2 rounded focus:ring-2 focus:ring-teal-500 outline-none" />
                    </div>
                    <button type="submit" className="bg-blue-600 text-white px-8 py-2 rounded-lg font-bold hover:bg-blue-700 shadow-lg border-b-4 border-blue-800 active:border-b-0 active:mt-1 transition-all h-[42px]">
                        + Créer
                    </button>
                </form>
            </div>

            {/* TABLEAU */}
            <div className="bg-white rounded-xl shadow overflow-hidden border border-gray-200">
                {loading ? (
                    <div className="p-10 text-center text-gray-500">Chargement de l'annuaire...</div>
                ) : filteredEleves.length === 0 ? (
                    <div className="p-10 text-center text-gray-400 italic">Aucun élève trouvé.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-gray-50 text-gray-600 uppercase text-xs tracking-wider">
                                <tr>
                                    <th className="p-4 border-b">Élève</th>
                                    <th className="p-4 border-b">Groupes Récurrents</th>
                                    <th className="p-4 border-b text-center">Crédits</th>
                                    <th className="p-4 border-b text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {filteredEleves.map(eleve => {
                                    const enrolledIds = eleve.enrolledGroupIds || [];
                                    const activeEnrollments = [];

                                    enrolledIds.forEach(gid => {
                                        const g = groupes.find(gr => gr.id === gid);
                                        if (g && isGroupActive(g)) activeEnrollments.push(g);
                                    });

                                    return (
                                        <tr key={eleve.id} className="hover:bg-gray-50 group transition-colors">
                                            <td className="p-4">
                                                <div className="font-bold text-gray-800">{eleve.nom} {eleve.prenom}</div>
                                                <div className="text-gray-400 text-xs">{eleve.email}</div>
                                            </td>
                                            <td className="p-4 text-sm text-gray-600">
                                                <div className="flex flex-col items-start gap-1">
                                                    {activeEnrollments.length > 0 ? (
                                                        activeEnrollments.map(g => (
                                                            <span key={g.id} className="bg-teal-50 text-teal-700 px-2 py-1 rounded-md font-bold text-xs border border-teal-100 whitespace-nowrap">
                                                                {g.nom} • {JOURS[g.jour]}
                                                            </span>
                                                        ))
                                                    ) : (
                                                        <span className="text-gray-400 italic text-xs">Ponctuel (Pas de groupe fixe)</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="p-4 text-center">
                                                <span className={`px-3 py-1 rounded-full text-xs font-bold ${eleve.absARemplacer > 0 ? 'bg-purple-100 text-purple-700' : (eleve.absARemplacer < 0 ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-400')}`}>
                                                    {eleve.absARemplacer > 0 ? '+' : ''}{eleve.absARemplacer}
                                                </span>
                                            </td>
                                            <td className="p-4 text-right">
                                                <div className="flex items-center justify-end gap-2">
                                                    <button onClick={() => openEditModal(eleve)} className="bg-blue-50 text-blue-600 hover:bg-blue-100 p-2 rounded-lg transition border border-blue-200" title="Éditer">✏️</button>
                                                    <button onClick={() => demanderSuppression(eleve.id, `${eleve.prenom} ${eleve.nom}`)} className="bg-red-50 text-red-600 hover:bg-red-100 p-2 rounded-lg transition border border-red-200" title="Supprimer">🗑️</button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* MODALE D'ÉDITION */}
            {eleveEnEdition && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50 backdrop-blur-sm" onClick={() => setEleveEnEdition(null)}>
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
                        <div className="bg-teal-700 p-6 text-white flex justify-between items-center relative">
                            <h3 className="text-2xl font-bold font-playfair">Édition Élève</h3>
                            <button onClick={() => setEleveEnEdition(null)} className="bg-black/20 hover:bg-black/40 text-white rounded-full w-8 h-8 flex items-center justify-center transition absolute top-6 right-6">✕</button>
                        </div>

                        <div className="p-6 overflow-y-auto bg-gray-50 flex-1 space-y-6">
                            {/* COORDONNÉES */}
                            <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                                <h4 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">👤 Infos & Crédits</h4>
                                <div className="grid grid-cols-2 gap-4 mb-4">
                                    <div>
                                        <label className="block text-xs font-bold text-gray-700 mb-1">Nom</label>
                                        <input type="text" value={eleveEnEdition.nom} onChange={(e) => setEleveEnEdition({ ...eleveEnEdition, nom: e.target.value })} className="w-full border p-2 rounded text-gray-800 uppercase focus:ring-2 focus:ring-teal-500 outline-none" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-700 mb-1">Prénom</label>
                                        <input type="text" value={eleveEnEdition.prenom} onChange={(e) => setEleveEnEdition({ ...eleveEnEdition, prenom: e.target.value })} className="w-full border p-2 rounded text-gray-800 focus:ring-2 focus:ring-teal-500 outline-none" />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-bold text-gray-700 mb-1">Email</label>
                                        <input type="email" value={eleveEnEdition.email || ''} onChange={(e) => setEleveEnEdition({ ...eleveEnEdition, email: e.target.value })} className="w-full border p-2 rounded text-gray-800 focus:ring-2 focus:ring-teal-500 outline-none" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-700 mb-1">Solde Crédits</label>
                                        <div className="relative">
                                            <input type="number" value={editCredits} onChange={(e) => setEditCredits(e.target.value)} className="w-full border p-2 rounded text-gray-800 font-bold bg-purple-50 text-purple-700 focus:ring-2 focus:ring-purple-500 outline-none pl-10" />
                                            <span className="absolute left-3 top-2 text-purple-400">🎫</span>
                                        </div>
                                        <p className="text-[10px] text-gray-400 mt-1 italic">Toute modification ici sera tracée dans l'historique.</p>
                                    </div>
                                </div>
                            </div>

                            {/* GROUPES SELECTION */}
                            <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                                <h4 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">📅 Inscriptions Récurrentes</h4>
                                <p className="text-xs text-gray-500 mb-3">Cochez les groupes où l'élève vient chaque semaine.</p>

                                <div className="grid md:grid-cols-2 gap-3">
                                    {groupes.filter(g => isGroupActive(g)).map(groupe => {
                                        const estInscrit = eleveEnEdition.enrolledGroupIds?.includes(groupe.id);
                                        return (
                                            <label key={groupe.id} className={`flex items-center p-3 rounded-lg border cursor-pointer transition select-none ${estInscrit ? 'bg-teal-50 border-teal-500' : 'border-gray-100 hover:bg-gray-50'}`}>
                                                <input type="checkbox" className="w-5 h-5 text-teal-600 rounded focus:ring-teal-500 border-gray-300" checked={estInscrit || false} onChange={() => toggleGroupePourEleve(groupe.id)} />
                                                <div className="ml-3">
                                                    <span className={`block font-bold ${estInscrit ? 'text-teal-900' : 'text-gray-600'}`}>{groupe.nom}</span>
                                                    <span className="text-xs text-gray-400 uppercase font-semibold">{JOURS[groupe.jour]} • {groupe.heureDebut}</span>
                                                </div>
                                            </label>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        <div className="p-4 bg-white border-t flex justify-end gap-3">
                            <button onClick={() => setEleveEnEdition(null)} className="px-4 py-2 text-gray-600 font-bold hover:bg-gray-100 rounded-lg transition">Annuler</button>
                            <button onClick={sauvegarderEdition} className="px-8 py-3 bg-teal-800 text-white font-bold rounded-lg hover:bg-teal-900 shadow-xl transition transform active:scale-95 border-b-4 border-teal-950 active:border-b-0 active:mt-1">
                                Enregistrer
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}