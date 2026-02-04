import { useState, useEffect } from 'react';
import { db } from './firebase';
import { collection, addDoc, getDocs, updateDoc, deleteDoc, doc, orderBy, query, serverTimestamp, arrayUnion } from 'firebase/firestore';
import toast from 'react-hot-toast';
import ConfirmModal from './components/ConfirmModal';

export default function Annuaire() {
    // --- ÉTATS ---
    const [eleves, setEleves] = useState([]);
    const [groupes, setGroupes] = useState([]);
    const [loading, setLoading] = useState(true);

    // Recherche & Filtres
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedGroupId, setSelectedGroupId] = useState(""); 
    const [paymentFilter, setPaymentFilter] = useState("all"); // 'all', 'ok', 'todo'
    
    // NOUVEAU : Filtre par période pour le paiement (Étape B)
    const [paymentPeriod, setPaymentPeriod] = useState("started"); // 'all', 'started', 'future'

    const [showArchived, setShowArchived] = useState(false);

    // Inscription Rapide
    const [showEnrollModal, setShowEnrollModal] = useState(false);
    const [enrollSearch, setEnrollSearch] = useState("");

    // Édition
    const [formData, setFormData] = useState({ nom: '', prenom: '', email: '' });
    const [eleveEnEdition, setEleveEnEdition] = useState(null);
    const [editCredits, setEditCredits] = useState(0);
    const [activeTab, setActiveTab] = useState('details'); 
    
    // Historique
    const [history, setHistory] = useState([]);
    const [loadingHistory, setLoadingHistory] = useState(false);

    // Modale de confirmation
    const [confirmConfig, setConfirmConfig] = useState(null);

    const JOURS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

    useEffect(() => {
        fetchData();
    }, []);

    // --- FONCTIONS UTILITAIRES ---

    const isGroupActive = (groupe) => {
        if (!groupe || !groupe._fin) return false;
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1); 
        return groupe._fin >= yesterday;
    };

    const sortGroupsLogic = (a, b) => {
        const aActive = isGroupActive(a);
        const bActive = isGroupActive(b);
        if (aActive && !bActive) return -1;
        if (!aActive && bActive) return 1;

        const getDayIndex = (d) => (d === 0 ? 7 : d);
        const dayDiff = getDayIndex(a.jour) - getDayIndex(b.jour);
        if (dayDiff !== 0) return dayDiff;

        return a.heureDebut.localeCompare(b.heureDebut);
    };

    const fetchData = async () => {
        try {
            setLoading(true);

            // 1. Charger Élèves
            const qEleves = query(collection(db, "eleves"), orderBy("nom"));
            const snapshotEleves = await getDocs(qEleves);
            setEleves(snapshotEleves.docs.map(doc => ({ id: doc.id, ...doc.data() })));

            // 2. Charger Groupes
            const snapshotGroupes = await getDocs(collection(db, "groupes"));
            const dataGroupes = snapshotGroupes.docs.map(doc => {
                const d = doc.data();
                const debut = d.dateDebut?.toDate ? d.dateDebut.toDate() : new Date('2024-01-01');
                const fin = d.dateFin?.toDate ? d.dateFin.toDate() : new Date('2030-01-01');
                return { id: doc.id, ...d, _debut: debut, _fin: fin };
            });

            dataGroupes.sort(sortGroupsLogic);
            setGroupes(dataGroupes);
        } catch (error) {
            console.error(error);
            toast.error("Erreur de chargement des données");
        } finally {
            setLoading(false);
        }
    };

    const fetchHistory = async (eleveId) => {
        setLoadingHistory(true);
        try {
            const q = query(collection(db, "eleves", eleveId, "history"), orderBy("date", "desc"));
            const snapshot = await getDocs(q);
            setHistory(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        } catch (error) {
            console.error("Erreur historique:", error);
            toast.error("Impossible de charger l'historique");
        } finally {
            setLoadingHistory(false);
        }
    };

    // --- LOGIQUE PAIEMENT ---
    
    const togglePaymentStatus = async (eleveId, groupeId, currentStatus) => {
        const newStatus = !currentStatus;
        
        setEleves(prev => prev.map(e => {
            if (e.id === eleveId) {
                const newPayments = { ...(e.payments || {}), [groupeId]: newStatus };
                return { ...e, payments: newPayments };
            }
            return e;
        }));

        try {
            await updateDoc(doc(db, "eleves", eleveId), {
                [`payments.${groupeId}`]: newStatus
            });
            toast.success(newStatus ? "Marqué comme PAYÉ" : "Marqué comme NON PAYÉ", { duration: 1500, icon: newStatus ? '✅' : '❌' });
        } catch (error) {
            console.error(error);
            toast.error("Erreur sauvegarde paiement");
            fetchData(); 
        }
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
                enrolledGroupIds: [],
                payments: {} 
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
            content: (
                <div>
                    <p>Êtes-vous sûr de vouloir supprimer définitivement <strong>{nomComplet}</strong> ?</p>
                    <p className="text-xs text-red-500 mt-2 font-bold">Cette action est irréversible.</p>
                </div>
            ),
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
                    toast.error("Erreur lors de la suppression");
                }
            }
        });
    };

    const deleteHistoryItem = async (historyId) => {
        if (!confirm("Supprimer cette ligne d'historique ? Cela n'impactera pas le solde actuel, c'est juste visuel.")) return;
        try {
            await deleteDoc(doc(db, "eleves", eleveEnEdition.id, "history", historyId));
            setHistory(prev => prev.filter(h => h.id !== historyId));
            toast.success("Ligne supprimée");
        } catch (e) {
            console.error(e);
            toast.error("Erreur suppression historique");
        }
    };

    // --- ACTIONS D'INSCRIPTION RAPIDE ---

    const handleEnrollStudent = async (studentId) => {
        if (!selectedGroupId) return;
        const student = eleves.find(e => e.id === studentId);
        const group = groupes.find(g => g.id === selectedGroupId);
        
        if (!student || !group) return;

        const toastId = toast.loading(`Inscription de ${student.prenom}...`);
        try {
            await updateDoc(doc(db, "eleves", studentId), {
                enrolledGroupIds: arrayUnion(selectedGroupId)
            });
            
            setEleves(prev => prev.map(e => {
                if (e.id === studentId) {
                    const currentGroups = e.enrolledGroupIds || [];
                    return { ...e, enrolledGroupIds: [...currentGroups, selectedGroupId] };
                }
                return e;
            }));

            toast.success(`${student.prenom} inscrit au cours !`, { id: toastId });
        } catch (error) {
            console.error(error);
            toast.error("Erreur lors de l'inscription", { id: toastId });
        }
    };

    // --- LOGIQUE MODALE ÉDITION ---

    const openEditModal = (eleve) => {
        setEleveEnEdition(eleve);
        setEditCredits(eleve.absARemplacer || 0);
        setActiveTab('details'); 
        fetchHistory(eleve.id);
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

            await updateDoc(userRef, {
                nom: eleveEnEdition.nom.toUpperCase(),
                prenom: eleveEnEdition.prenom,
                email: eleveEnEdition.email.trim().toLowerCase(),
                enrolledGroupIds: eleveEnEdition.enrolledGroupIds,
                absARemplacer: nouveauxCredits
            });

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

    // --- FILTRAGE FINAL ---
    const filteredEleves = eleves.filter(e => {
        const matchesSearch = (e.nom + ' ' + e.prenom).toLowerCase().includes(searchTerm.toLowerCase());
        const matchesGroup = selectedGroupId === "" || (e.enrolledGroupIds && e.enrolledGroupIds.includes(selectedGroupId));
        
        let matchesPayment = true;
        if (paymentFilter !== 'all') {
            const userGroups = (e.enrolledGroupIds || [])
                .map(gid => groupes.find(g => g.id === gid))
                .filter(Boolean);

            if (userGroups.length === 0) {
                matchesPayment = (paymentFilter === 'ok'); 
            } else {
                const now = new Date();
                
                // Filtrer les groupes selon la période sélectionnée
                const relevantGroups = userGroups.filter(g => {
                    if (paymentPeriod === 'all') return true;
                    const hasStarted = now >= g._debut;
                    return paymentPeriod === 'started' ? hasStarted : !hasStarted;
                });

                if (relevantGroups.length === 0) {
                    matchesPayment = (paymentFilter === 'ok'); 
                } else {
                    const allPaid = relevantGroups.every(g => e.payments?.[g.id] === true);
                    if (paymentFilter === 'ok') matchesPayment = allPaid;
                    if (paymentFilter === 'todo') matchesPayment = !allPaid;
                }
            }
        }

        return matchesSearch && matchesGroup && matchesPayment;
    });

    const selectedGroupObj = groupes.find(g => g.id === selectedGroupId);
    const eligibleStudentsForEnrollment = eleves.filter(e => {
        const matchesModalSearch = (e.nom + ' ' + e.prenom).toLowerCase().includes(enrollSearch.toLowerCase());
        const notAlreadyIn = !(e.enrolledGroupIds && e.enrolledGroupIds.includes(selectedGroupId));
        return matchesModalSearch && notAlreadyIn;
    });


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

            {/* HEADER ET OUTILS DE FILTRE */}
            <div className="flex flex-col gap-6 mb-8 bg-white p-5 rounded-xl shadow-sm border border-gray-200">
                <div className="flex justify-between items-center border-b border-gray-100 pb-4">
                    <h2 className="text-2xl font-playfair font-bold text-teal-900">
                        Annuaire Élèves ({filteredEleves.length})
                    </h2>
                    
                    <div className="flex items-center bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-white transition cursor-pointer" onClick={() => setShowArchived(!showArchived)}>
                        <span className="text-xs font-bold text-gray-600 mr-2 select-none">
                            Voir cours terminés
                        </span>
                        <div className={`relative w-10 h-5 rounded-full transition duration-200 ease-in-out ${showArchived ? 'bg-teal-500' : 'bg-gray-300'}`}>
                            <div className={`absolute left-0.5 top-0.5 bg-white w-4 h-4 rounded-full shadow-md transform transition duration-200 ease-in-out ${showArchived ? 'translate-x-5' : 'translate-x-0'}`}></div>
                        </div>
                    </div>
                </div>

                <div className="flex flex-col md:flex-row gap-4 items-end md:items-center justify-between">
                    <div className="relative w-full md:w-1/4">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
                        <input
                            type="text"
                            placeholder="Nom / Prénom..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 outline-none text-sm shadow-sm"
                        />
                    </div>

                    <div className="flex-1 w-full grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
                        <div>
                            <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1 ml-1">Groupe</label>
                            <select
                                value={selectedGroupId}
                                onChange={(e) => setSelectedGroupId(e.target.value)}
                                className={`w-full border py-2 px-3 rounded-lg text-sm font-medium outline-none focus:ring-2 focus:ring-teal-500 shadow-sm transition ${selectedGroupId ? 'bg-purple-50 text-purple-900 border-purple-300' : 'bg-white text-gray-600'}`}
                            >
                                <option value="">-- Tous les élèves --</option>
                                {groupes.map(g => {
                                    const active = isGroupActive(g);
                                    return (
                                        <option key={g.id} value={g.id} className={!active ? 'text-gray-400' : 'text-gray-900 font-bold'}>
                                            {active ? "🟢" : "💤"} {JOURS[g.jour]} {g.heureDebut} - {g.nom}
                                        </option>
                                    );
                                })}
                            </select>
                        </div>

                         <div>
                            <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1 ml-1">Paiement</label>
                            <select
                                value={paymentFilter}
                                onChange={(e) => setPaymentFilter(e.target.value)}
                                className={`w-full border py-2 px-3 rounded-lg text-sm font-bold outline-none focus:ring-2 shadow-sm transition h-[38px] ${paymentFilter === 'todo' ? 'bg-red-50 text-red-600 border-red-200' : (paymentFilter === 'ok' ? 'bg-teal-50 text-teal-600 border-teal-200' : 'bg-white text-gray-600 border-gray-200')}`}
                            >
                                <option value="all">Tout</option>
                                <option value="ok">✅ À jour</option>
                                <option value="todo">❌ Impayés</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1 ml-1">Période de paiement</label>
                            <select
                                value={paymentPeriod}
                                onChange={(e) => setPaymentPeriod(e.target.value)}
                                className="w-full border border-gray-200 py-2 px-3 rounded-lg text-sm font-bold outline-none focus:ring-2 focus:ring-teal-500 bg-gray-50 text-gray-700 h-[38px]"
                            >
                                <option value="all">Toutes périodes</option>
                                <option value="started">Cours actuels (Démarrés)</option>
                                <option value="future">Trimestres futurs</option>
                            </select>
                        </div>
                    </div>

                    {selectedGroupId && (
                        <button 
                            onClick={() => { setEnrollSearch(""); setShowEnrollModal(true); }}
                            className="bg-purple-600 text-white px-3 py-2 rounded-lg font-bold text-sm hover:bg-purple-700 shadow-md transition flex items-center gap-1 h-[38px] whitespace-nowrap"
                        >
                            👤+ Inscrire
                        </button>
                    )}
                </div>
            </div>

            {/* FORMULAIRE CRÉATION ÉLÈVE */}
            <div className="bg-white p-4 rounded-xl shadow-sm mb-8 border border-gray-100">
                 <h3 className="font-bold text-sm text-teal-800 uppercase tracking-wide mb-3">Créer un nouvel élève</h3>
                 <form onSubmit={handleSubmit} className="flex flex-col md:flex-row gap-3 items-end">
                    <div className="flex-1 w-full">
                        <label className="text-[10px] font-bold text-gray-400 uppercase ml-1 mb-1 block">Nom</label>
                        <input type="text" placeholder="DUPONT" value={formData.nom} onChange={e => setFormData({ ...formData, nom: e.target.value })} className="w-full border p-2 rounded uppercase text-sm focus:ring-2 focus:ring-teal-500 outline-none" required />
                    </div>
                    <div className="flex-1 w-full">
                        <label className="text-[10px] font-bold text-gray-400 uppercase ml-1 mb-1 block">Prénom</label>
                        <input type="text" placeholder="Marie" value={formData.prenom} onChange={e => setFormData({ ...formData, prenom: e.target.value })} className="w-full border p-2 rounded text-sm focus:ring-2 focus:ring-teal-500 outline-none" required />
                    </div>
                    <div className="flex-1 w-full">
                        <label className="text-[10px] font-bold text-gray-400 uppercase ml-1 mb-1 block">Email</label>
                        <input type="email" placeholder="marie@mail.com" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} className="w-full border p-2 rounded text-sm focus:ring-2 focus:ring-teal-500 outline-none" />
                    </div>
                    <button type="submit" className="bg-teal-700 text-white px-6 py-2 rounded-lg font-bold text-sm hover:bg-teal-800 shadow-sm transition h-[38px] flex items-center gap-2">
                        <span>+</span> Créer
                    </button>
                </form>
            </div>

            {/* TABLEAU LISTE */}
            <div className="bg-white rounded-xl shadow overflow-hidden border border-gray-200">
                {loading ? (
                    <div className="p-10 text-center text-gray-500 font-medium">Chargement...</div>
                ) : filteredEleves.length === 0 ? (
                    <div className="p-10 text-center text-gray-400 italic">
                        Aucun élève trouvé.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-gray-50 text-gray-600 uppercase text-xs tracking-wider">
                                <tr>
                                    <th className="p-4 border-b w-1/4">Identité</th>
                                    <th className="p-4 border-b w-1/2">Groupes inscrits & Paiement</th>
                                    <th className="p-4 border-b text-center">Crédits</th>
                                    <th className="p-4 border-b text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {filteredEleves.map(eleve => {
                                    const rawGroups = (eleve.enrolledGroupIds || [])
                                        .map(gid => groupes.find(g => g.id === gid))
                                        .filter(Boolean);

                                    const activeGroups = rawGroups.filter(g => isGroupActive(g)).sort(sortGroupsLogic);
                                    const finishedGroups = rawGroups.filter(g => !isGroupActive(g)).sort(sortGroupsLogic);

                                    const displayGroups = showArchived 
                                        ? [...activeGroups, ...finishedGroups] 
                                        : activeGroups;

                                    return (
                                        <tr key={eleve.id} className="hover:bg-gray-50 group transition-colors">
                                            <td className="p-4 align-top">
                                                <div className="font-bold text-gray-800">{eleve.nom} {eleve.prenom}</div>
                                                <div className="text-gray-400 text-xs mt-0.5">{eleve.email}</div>
                                            </td>
                                            <td className="p-4 text-sm text-gray-600 align-top">
                                                <div className="flex flex-wrap gap-2">
                                                    {displayGroups.length > 0 ? (
                                                        displayGroups.map(g => {
                                                            const active = isGroupActive(g);
                                                            const isPaid = eleve.payments?.[g.id] === true;
                                                            
                                                            const hasStarted = new Date() >= g._debut;
                                                            
                                                            // Style dynamique pour le bouton paiement
                                                            let payBtnClass = "";
                                                            if (isPaid) {
                                                                payBtnClass = "bg-green-500 text-white border-green-600";
                                                            } else {
                                                                // Si non payé : rouge si démarré, jaune/orange si futur
                                                                payBtnClass = hasStarted 
                                                                    ? "bg-red-500 text-white border-red-600" 
                                                                    : "bg-amber-400 text-amber-900 border-amber-500 opacity-80";
                                                            }

                                                            return (
                                                                <div key={g.id} className="flex items-center">
                                                                    <span 
                                                                        className={`px-2 py-1 rounded-l-md text-xs font-bold border-t border-b border-l whitespace-nowrap flex items-center gap-1 transition-colors h-[26px]
                                                                        ${active 
                                                                            ? 'bg-teal-50 text-teal-800 border-teal-200' 
                                                                            : 'bg-gray-100 text-gray-400 border-gray-200 grayscale'}`}
                                                                        title={!active ? "Cours terminé" : (hasStarted ? "Cours en cours" : "Trimestre futur")}
                                                                    >
                                                                        {!hasStarted && active && <span className="text-[10px]">⏳</span>}
                                                                        {g.nom} • {JOURS[g.jour]} {g.heureDebut}
                                                                    </span>
                                                                    <button 
                                                                        onClick={() => togglePaymentStatus(eleve.id, g.id, isPaid)}
                                                                        className={`px-2 py-1 rounded-r-md text-[10px] font-bold border-t border-b border-r h-[26px] transition-all hover:brightness-110 active:scale-95 ${payBtnClass}`}
                                                                    >
                                                                        {isPaid ? "€ OK" : (hasStarted ? "€ --" : "€ FUTUR")}
                                                                    </button>
                                                                </div>
                                                            )
                                                        })
                                                    ) : (
                                                        <span className="text-gray-400 italic text-xs py-1">Aucun groupe.</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="p-4 text-center align-middle">
                                                <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold shadow-sm ${eleve.absARemplacer > 0 ? 'bg-purple-100 text-purple-700' : (eleve.absARemplacer < 0 ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500')}`}>
                                                    {eleve.absARemplacer > 0 ? '+' : ''}{eleve.absARemplacer}
                                                </span>
                                            </td>
                                            <td className="p-4 text-right align-middle">
                                                <div className="flex items-center justify-end gap-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                                                    <button onClick={() => openEditModal(eleve)} className="bg-white hover:bg-blue-50 text-gray-400 hover:text-blue-600 border border-gray-200 hover:border-blue-200 p-2 rounded-lg transition shadow-sm">
                                                        ✏️
                                                    </button>
                                                    <button onClick={() => demanderSuppression(eleve.id, `${eleve.prenom} ${eleve.nom}`)} className="bg-white hover:bg-red-50 text-gray-400 hover:text-red-600 border border-gray-200 hover:border-red-200 p-2 rounded-lg transition shadow-sm">
                                                        🗑️
                                                    </button>
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

            {/* MODALE D'INSCRIPTION RAPIDE */}
            {showEnrollModal && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50 backdrop-blur-sm" onClick={() => setShowEnrollModal(false)}>
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95" onClick={e => e.stopPropagation()}>
                        <div className="bg-purple-700 p-4 text-white flex justify-between items-center">
                            <div>
                                <h3 className="font-bold font-playfair text-lg">Inscrire un élève</h3>
                                <p className="text-purple-200 text-xs">Groupe : {selectedGroupObj?.nom}</p>
                            </div>
                            <button onClick={() => setShowEnrollModal(false)} className="text-white/60 hover:text-white font-bold">✕</button>
                        </div>
                        <div className="p-4">
                            <input 
                                type="text" 
                                autoFocus
                                placeholder="🔍 Chercher un élève..." 
                                value={enrollSearch}
                                onChange={e => setEnrollSearch(e.target.value)}
                                className="w-full border p-2 rounded-lg mb-3 focus:ring-2 focus:ring-purple-500 outline-none"
                            />
                            <div className="max-h-64 overflow-y-auto border rounded-lg divide-y divide-gray-100">
                                {eligibleStudentsForEnrollment.length === 0 ? (
                                    <div className="p-4 text-center text-gray-400 text-sm italic">Aucun élève trouvé.</div>
                                ) : (
                                    eligibleStudentsForEnrollment.map(eleve => (
                                        <div key={eleve.id} className="p-3 hover:bg-purple-50 flex justify-between items-center group cursor-pointer" onClick={() => handleEnrollStudent(eleve.id)}>
                                            <div>
                                                <div className="font-bold text-gray-800 text-sm">{eleve.nom} {eleve.prenom}</div>
                                                <div className="text-xs text-gray-400">{eleve.email}</div>
                                            </div>
                                            <button className="bg-white text-purple-600 border border-purple-200 px-3 py-1 rounded text-xs font-bold group-hover:bg-purple-600 group-hover:text-white transition">
                                                Ajouter
                                            </button>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* MODALE D'ÉDITION COMPLETE */}
            {eleveEnEdition && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50 backdrop-blur-sm" onClick={() => setEleveEnEdition(null)}>
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95" onClick={e => e.stopPropagation()}>
                        
                        <div className="bg-gradient-to-r from-teal-800 to-teal-700 p-5 text-white flex justify-between items-center relative shadow-md shrink-0">
                            <div>
                                <h3 className="text-xl font-bold font-playfair flex items-center gap-2">
                                    <span>👤</span> Édition Élève
                                </h3>
                                <p className="text-teal-100 text-sm mt-0.5">{eleveEnEdition.prenom} {eleveEnEdition.nom}</p>
                            </div>
                            <button onClick={() => setEleveEnEdition(null)} className="bg-white/20 hover:bg-white/30 text-white rounded-full w-8 h-8 flex items-center justify-center transition">✕</button>
                        </div>

                        <div className="flex border-b border-gray-200 bg-gray-50 shrink-0">
                            <button onClick={() => setActiveTab('details')} className={`flex-1 py-3 font-bold text-sm transition border-b-2 ${activeTab === 'details' ? 'text-teal-800 border-teal-800 bg-white' : 'text-gray-500 border-transparent hover:text-gray-700'}`}>👤 Détails & Groupes</button>
                            <button onClick={() => setActiveTab('history')} className={`flex-1 py-3 font-bold text-sm transition border-b-2 ${activeTab === 'history' ? 'text-teal-800 border-teal-800 bg-white' : 'text-gray-500 border-transparent hover:text-gray-700'}`}>📜 Historique</button>
                        </div>

                        <div className="p-6 overflow-y-auto bg-gray-50/50 flex-1 space-y-6">
                            {activeTab === 'details' && (
                                <>
                                    <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200">
                                        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4 border-b pb-2 flex items-center gap-2"><span>📝</span> Informations</h4>
                                        <div className="grid grid-cols-2 gap-4 mb-4">
                                            <div>
                                                <label className="block text-xs font-bold text-gray-600 mb-1">Nom</label>
                                                <input type="text" value={eleveEnEdition.nom} onChange={(e) => setEleveEnEdition({ ...eleveEnEdition, nom: e.target.value })} className="w-full border border-gray-300 p-2.5 rounded-lg uppercase text-sm focus:ring-2 focus:ring-teal-500 outline-none" />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-bold text-gray-600 mb-1">Prénom</label>
                                                <input type="text" value={eleveEnEdition.prenom} onChange={(e) => setEleveEnEdition({ ...eleveEnEdition, prenom: e.target.value })} className="w-full border border-gray-300 p-2.5 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 outline-none" />
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className="block text-xs font-bold text-gray-600 mb-1">Email</label>
                                                <input type="email" value={eleveEnEdition.email || ''} onChange={(e) => setEleveEnEdition({ ...eleveEnEdition, email: e.target.value })} className="w-full border border-gray-300 p-2.5 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 outline-none" />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-bold text-gray-600 mb-1">Solde Crédits</label>
                                                <div className="relative">
                                                    <input type="number" value={editCredits} onChange={(e) => setEditCredits(e.target.value)} className="w-full border border-purple-200 p-2.5 rounded-lg font-bold bg-purple-50 text-purple-700 focus:ring-2 focus:ring-purple-500 outline-none pl-9" />
                                                    <span className="absolute left-3 top-2.5 text-purple-400">🎫</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200">
                                        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 border-b pb-2 flex items-center gap-2"><span>📅</span> Inscriptions</h4>
                                        <div className="grid md:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                                            {groupes.filter(g => isGroupActive(g)).map(groupe => {
                                                const estInscrit = eleveEnEdition.enrolledGroupIds?.includes(groupe.id);
                                                return (
                                                    <label key={groupe.id} className={`flex items-center p-2.5 rounded-lg border cursor-pointer select-none transition-all ${estInscrit ? 'bg-teal-50 border-teal-500 shadow-sm ring-1 ring-teal-500' : 'border-gray-100 hover:bg-gray-50'}`}>
                                                        <input type="checkbox" className="w-4 h-4 text-teal-600 rounded border-gray-300 focus:ring-teal-500" checked={estInscrit || false} onChange={() => toggleGroupePourEleve(groupe.id)} />
                                                        <div className="ml-3 leading-tight">
                                                            <span className={`block text-sm font-bold ${estInscrit ? 'text-teal-900' : 'text-gray-600'}`}>{groupe.nom}</span>
                                                            <span className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">{JOURS[groupe.jour]} • {groupe.heureDebut}</span>
                                                        </div>
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </>
                            )}

                            {activeTab === 'history' && (
                                <div className="space-y-3">
                                    {loadingHistory ? (
                                        <div className="text-center text-gray-400 py-10">Chargement...</div>
                                    ) : history.length === 0 ? (
                                        <div className="text-center text-gray-400 italic py-10 bg-white rounded-xl border border-dashed border-gray-300">Aucun historique.</div>
                                    ) : (
                                        history.map(item => {
                                            const dateItem = item.date ? item.date.toDate() : new Date();
                                            const isPositive = item.delta > 0;
                                            return (
                                                <div key={item.id} className="bg-white p-3 rounded-lg border border-gray-200 flex justify-between items-center text-sm shadow-sm hover:shadow-md transition">
                                                    <div>
                                                        <div className="flex items-center gap-2 mb-1">
                                                            <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${isPositive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                                                {isPositive ? '+' : ''}{item.delta}
                                                            </span>
                                                            <span className="font-bold text-gray-700">{item.motif}</span>
                                                        </div>
                                                        <div className="text-xs text-gray-400">📅 {dateItem.toLocaleDateString('fr-FR')} {item.seanceDate && `• Séance : ${item.seanceDate}`}</div>
                                                    </div>
                                                    <button onClick={() => deleteHistoryItem(item.id)} className="text-gray-300 hover:text-red-500 p-2 rounded hover:bg-red-50 transition">🗑️</button>
                                                </div>
                                            )
                                        })
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="p-4 bg-white border-t border-gray-200 flex justify-end gap-3 shrink-0">
                            <button onClick={() => setEleveEnEdition(null)} className="px-5 py-2.5 text-gray-500 font-bold hover:bg-gray-100 rounded-lg transition text-sm">Annuler</button>
                            {activeTab === 'details' && (
                                <button onClick={sauvegarderEdition} className="px-6 py-2.5 bg-teal-700 text-white font-bold rounded-lg hover:bg-teal-800 shadow-md transform active:scale-95 transition text-sm">Enregistrer</button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}