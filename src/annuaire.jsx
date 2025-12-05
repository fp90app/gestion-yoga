import { useState, useEffect } from 'react';
import { db } from './firebase';
import { collection, addDoc, getDocs, updateDoc, deleteDoc, doc, orderBy, query, Timestamp, where } from 'firebase/firestore';

export default function Annuaire() {
    const [eleves, setEleves] = useState([]);
    const [groupes, setGroupes] = useState([]);
    const [editCredits, setEditCredits] = useState(0);
    const [formData, setFormData] = useState({ nom: '', prenom: '', email: '' });
    const [eleveEnEdition, setEleveEnEdition] = useState(null);
    const [editDateFin, setEditDateFin] = useState("");

    useEffect(() => { fetchData(); }, []);

    const fetchData = async () => {
        const qEleves = query(collection(db, "eleves"), orderBy("nom"));
        const snapshotEleves = await getDocs(qEleves);
        setEleves(snapshotEleves.docs.map(doc => ({ id: doc.id, ...doc.data() })));

        const qGroupes = query(collection(db, "groupes"), where("actif", "==", true));
        const snapshotGroupes = await getDocs(qGroupes);
        const dataGroupes = snapshotGroupes.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        dataGroupes.sort((a, b) => (a.jour - b.jour) || a.heureDebut.localeCompare(b.heureDebut));
        setGroupes(dataGroupes);
    };

    const timestampToDateInput = (ts) => {
        if (!ts || !ts.toDate) return "";
        return ts.toDate().toISOString().split('T')[0];
    };

    const formatDateReadable = (ts) => {
        if (!ts || !ts.toDate) return "Pas de date";
        return ts.toDate().toLocaleDateString('fr-FR');
    };

    const isExpired = (ts) => {
        if (!ts || !ts.toDate) return true;
        return ts.toDate() < new Date();
    };

    const openEditModal = (eleve) => {
        setEleveEnEdition(eleve);
        setEditDateFin(timestampToDateInput(eleve.finAbonnement));
        setEditCredits(eleve.absARemplacer || 0);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!formData.nom || !formData.prenom) return;
        try {
            const dateFin = new Date();
            dateFin.setFullYear(dateFin.getFullYear() + 1);
            await addDoc(collection(db, "eleves"), {
                nom: formData.nom.toUpperCase(),
                prenom: formData.prenom,
                email: formData.email.trim().toLowerCase(),
                role: "student",
                absARemplacer: 0,
                enrolledGroupIds: [],
                finAbonnement: Timestamp.fromDate(dateFin)
            });
            setFormData({ nom: '', prenom: '', email: '' });
            fetchData();
        } catch (error) {
            console.error("Erreur ajout:", error);
            alert("Erreur lors de la création");
        }
    };

    const supprimerEleve = async (id, nomComplet) => {
        if (window.confirm(`Êtes-vous sûr de vouloir supprimer définitivement ${nomComplet} ?`)) {
            try {
                await deleteDoc(doc(db, "eleves", id));
                setEleves(prev => prev.filter(e => e.id !== id));
            } catch (error) {
                console.error("Erreur suppression", error);
            }
        }
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

    const ajouterMois = (nbMois) => {
        let current = editDateFin ? new Date(editDateFin) : new Date();
        current.setMonth(current.getMonth() + nbMois);
        setEditDateFin(current.toISOString().split('T')[0]);
    };

    const sauvegarderEdition = async () => {
        try {
            const userRef = doc(db, "eleves", eleveEnEdition.id);
            let newTimestamp = eleveEnEdition.finAbonnement;
            if (editDateFin) {
                newTimestamp = Timestamp.fromDate(new Date(editDateFin));
            }
            await updateDoc(userRef, {
                nom: eleveEnEdition.nom.toUpperCase(),
                prenom: eleveEnEdition.prenom,
                email: eleveEnEdition.email.trim().toLowerCase(),
                enrolledGroupIds: eleveEnEdition.enrolledGroupIds,
                finAbonnement: newTimestamp,
                absARemplacer: parseInt(editCredits)
            });
            alert("Modifications enregistrées !");
            setEleveEnEdition(null);
            fetchData();
        } catch (error) {
            console.error("Erreur sauvegarde:", error);
            alert("Erreur lors de la sauvegarde");
        }
    };

    const JOURS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

    return (
        <div className="max-w-6xl mx-auto p-4 relative">
            <h2 className="text-3xl font-playfair font-bold text-gray-800 mb-6 border-b pb-2">
                Annuaire des Élèves 👥
            </h2>

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
                    {/* BOUTON CRÉER PLUS VISIBLE */}
                    {/* Dans le formulaire d'ajout */}
                    <button
                        type="submit"
                        className="bg-blue-600 text-white px-8 py-2 rounded-lg font-bold hover:bg-blue-700 shadow-lg border-b-4 border-blue-800 active:border-b-0 active:mt-1 transition-all h-[42px]"
                    >
                        + Créer
                    </button>
                </form>
            </div>

            <div className="bg-white rounded-xl shadow overflow-hidden border border-gray-200">
                <table className="w-full text-left border-collapse">
                    <thead className="bg-gray-50 text-gray-600 uppercase text-xs tracking-wider">
                        <tr>
                            <th className="p-4 border-b">Élève</th>
                            <th className="p-4 border-b">Groupes</th>
                            <th className="p-4 border-b">Abonnement</th>
                            <th className="p-4 border-b text-center">Crédits</th>
                            <th className="p-4 border-b text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {eleves.map(eleve => {
                            const expired = isExpired(eleve.finAbonnement);
                            return (
                                <tr key={eleve.id} className="hover:bg-gray-50 group transition-colors">
                                    <td className="p-4">
                                        <div className="font-bold text-gray-800">{eleve.nom} {eleve.prenom}</div>
                                        <div className="text-gray-400 text-xs">{eleve.email}</div>
                                    </td>
                                    <td className="p-4 text-sm text-gray-600">
                                        {eleve.enrolledGroupIds && eleve.enrolledGroupIds.length > 0
                                            ? <span className="bg-teal-50 text-teal-700 px-2 py-1 rounded-md font-bold text-xs border border-teal-100">{eleve.enrolledGroupIds.length} cours / sem</span>
                                            : <span className="text-gray-400 italic text-xs">Aucun</span>
                                        }
                                    </td>
                                    <td className="p-4">
                                        <div className={`text-sm font-bold flex items-center gap-2 ${expired ? 'text-red-600' : 'text-green-600'}`}>
                                            <span className={`w-2 h-2 rounded-full ${expired ? 'bg-red-500' : 'bg-green-500'}`}></span>
                                            {formatDateReadable(eleve.finAbonnement)}
                                        </div>
                                        {expired && <div className="text-xs text-red-400 font-semibold uppercase mt-1">Expiré</div>}
                                    </td>
                                    <td className="p-4 text-center">
                                        <span className={`px-3 py-1 rounded-full text-xs font-bold ${eleve.absARemplacer > 0 ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-400'}`}>
                                            {eleve.absARemplacer}
                                        </span>
                                    </td>
                                    <td className="p-4 text-right flex items-center justify-end gap-2">
                                        <button
                                            onClick={() => openEditModal(eleve)}
                                            className="bg-blue-50 text-blue-600 hover:bg-blue-100 p-2 rounded-lg transition border border-blue-200"
                                            title="Éditer"
                                        >
                                            ✏️
                                        </button>
                                        <button
                                            onClick={() => supprimerEleve(eleve.id, `${eleve.prenom} ${eleve.nom}`)}
                                            className="bg-red-50 text-red-600 hover:bg-red-100 p-2 rounded-lg transition border border-red-200"
                                            title="Supprimer"
                                        >
                                            🗑️
                                        </button>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* MODALE D'ÉDITION */}
            {eleveEnEdition && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">

                        {/* Header Modale */}
                        <div className="bg-teal-700 p-6 text-white flex justify-between items-center relative">
                            <div>
                                <h3 className="text-2xl font-bold font-playfair">Modification Élève</h3>
                            </div>
                            <button
                                onClick={() => setEleveEnEdition(null)}
                                className="bg-black/20 hover:bg-black/40 text-white rounded-full w-8 h-8 flex items-center justify-center transition absolute top-6 right-6"
                            >
                                ✕
                            </button>
                        </div>

                        <div className="p-6 overflow-y-auto bg-gray-50 flex-1 space-y-6">

                            {/* COORDONNÉES */}
                            <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                                <h4 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">👤 Coordonnées</h4>
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
                                <div>
                                    <label className="block text-xs font-bold text-gray-700 mb-1">Email</label>
                                    <input type="email" value={eleveEnEdition.email || ''} onChange={(e) => setEleveEnEdition({ ...eleveEnEdition, email: e.target.value })} className="w-full border p-2 rounded text-gray-800 focus:ring-2 focus:ring-teal-500 outline-none" placeholder="Pas d'email défini" />
                                </div>
                                <div className="mt-4">
                                    <label className="block text-xs font-bold text-gray-700 mb-1">Solde Crédits</label>
                                    <input type="number" value={editCredits} onChange={(e) => setEditCredits(e.target.value)} className="w-full border p-2 rounded text-gray-800 font-bold bg-purple-50 text-purple-700 focus:ring-2 focus:ring-purple-500 outline-none" />
                                </div>
                            </div>

                            {/* ABONNEMENT */}
                            <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                                <h4 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">📅 Abonnement</h4>
                                <div className="flex flex-col md:flex-row gap-4 items-end">
                                    <div className="flex-1 w-full">
                                        <label className="block text-xs font-bold text-gray-700 mb-1">Date de fin</label>
                                        <input type="date" value={editDateFin} onChange={(e) => setEditDateFin(e.target.value)} className="w-full border p-2 rounded-lg text-gray-800 font-bold focus:ring-2 focus:ring-teal-500 outline-none" />
                                    </div>
                                    <div className="flex gap-2">
                                        <button onClick={() => ajouterMois(1)} className="px-3 py-2 bg-teal-50 text-teal-700 text-xs font-bold rounded hover:bg-teal-100 transition">+1 M</button>
                                        <button onClick={() => ajouterMois(3)} className="px-3 py-2 bg-teal-50 text-teal-700 text-xs font-bold rounded hover:bg-teal-100 transition">+3 M</button>
                                        <button onClick={() => ajouterMois(12)} className="px-3 py-2 bg-teal-50 text-teal-700 text-xs font-bold rounded hover:bg-teal-100 transition">+1 An</button>
                                    </div>
                                </div>
                            </div>

                            {/* GROUPES */}
                            <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                                <h4 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">🧘‍♀️ Inscriptions</h4>
                                <div className="grid md:grid-cols-2 gap-3">
                                    {groupes.map(groupe => {
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