import { useState, useEffect } from 'react';
import { db } from './firebase';
import {
    collection,
    getDocs,
    doc,
    getDoc,
    writeBatch,
    increment,
    updateDoc,
    arrayUnion,
    arrayRemove,
    serverTimestamp,
    Timestamp,
    deleteField,
    addDoc,
    deleteDoc,
    query,
    where
} from 'firebase/firestore';
import toast from 'react-hot-toast'; // <--- IMPORT TOAST
import ConfirmModal from './components/ConfirmModal'; // <--- IMPORT MODALE

export default function GestionSeance({ groupe, date, onClose, onEdit }) {
    // --- ÉTATS ---
    const [inscrits, setInscrits] = useState([]);
    const [invites, setInvites] = useState([]);
    const [waitingList, setWaitingList] = useState([]);
    const [allStudents, setAllStudents] = useState([]);

    const [statuses, setStatuses] = useState({});
    const [initialStatus, setInitialStatus] = useState({});

    // Liens : { [guestId]: titulaireId }
    const [replacementLinks, setReplacementLinks] = useState({});
    // Origines : { [guestId]: 'waiting' | 'manual' }
    const [guestOrigins, setGuestOrigins] = useState({});

    const [loading, setLoading] = useState(true);
    const [estAnnule, setEstAnnule] = useState(false);
    const [annulationDocId, setAnnulationDocId] = useState(null);

    // État pour la modale de confirmation
    const [confirmConfig, setConfirmConfig] = useState(null);

    // --- SÉLECTEURS ---
    const [selectedStudentId, setSelectedStudentId] = useState(""); // Pour l'ajout manuel
    const [isAjoutManuel, setIsAjoutManuel] = useState(false); // Bascule affichage

    // Identifiant unique de la séance
    const seanceId = groupe.isExceptionnel ? groupe.id : `${date}_${groupe.id}`;

    useEffect(() => {
        fetchData();
    }, [groupe, date]);

    const fetchData = async () => {
        setLoading(true);
        try {
            // 1. Charger tous les élèves (pour les noms)
            const elevesSnap = await getDocs(collection(db, "eleves"));
            const elevesMap = {};
            const elevesList = [];
            elevesSnap.forEach(doc => {
                const data = doc.data();
                elevesMap[doc.id] = { id: doc.id, ...data };
                elevesList.push({ id: doc.id, ...data });
            });
            // Tri alphabétique pour la liste déroulante
            elevesList.sort((a, b) => a.nom.localeCompare(b.nom));
            setAllStudents(elevesList);

            // 2. Identifier les titulaires (inscrits au groupe)
            let titulairesIds = [];
            if (!groupe.isExceptionnel) {
                // On filtre dans la liste complète ceux qui ont ce groupeId
                titulairesIds = elevesList
                    .filter(e => e.enrolledGroupIds && e.enrolledGroupIds.includes(groupe.id))
                    .map(e => e.id);
            }

            // 3. Charger l'attendance (ou l'exception)
            const attendanceRef = doc(db, "attendance", seanceId);
            const attendanceSnap = await getDoc(attendanceRef);

            let currentStatus = {};
            let currentLinks = {};
            let waitingIds = [];

            if (attendanceSnap.exists()) {
                const data = attendanceSnap.data();
                currentStatus = data.status || {};
                currentLinks = data.replacementLinks || {};
                waitingIds = data.waitingList || [];
                setReplacementLinks(currentLinks);
            }

            setStatuses(currentStatus);
            setInitialStatus(JSON.parse(JSON.stringify(currentStatus))); // Deep copy pour comparaison

            // 4. Construire les listes d'objets
            const inscritsObj = titulairesIds.map(id => elevesMap[id]).filter(Boolean);

            // Les invités sont ceux qui sont dans status 'present' MAIS pas titulaires
            const guestIds = Object.keys(currentStatus).filter(uid => {
                const st = currentStatus[uid];
                return st === 'present' && !titulairesIds.includes(uid);
            });

            const invitesObj = guestIds.map(id => elevesMap[id]).filter(Boolean);
            const waitingObj = waitingIds.map(id => elevesMap[id]).filter(Boolean);

            setInscrits(inscritsObj);
            setInvites(invitesObj);
            setWaitingList(waitingObj);

            // 5. Vérifier si le cours est annulé (Exception)
            if (!groupe.isExceptionnel) {
                const exQuery = query(
                    collection(db, "exceptions"),
                    where("groupeId", "==", groupe.id),
                    where("date", "==", date),
                    where("type", "==", "annulation")
                );
                const exSnap = await getDocs(exQuery);
                if (!exSnap.empty) {
                    setEstAnnule(true);
                    setAnnulationDocId(exSnap.docs[0].id);
                }
            }

        } catch (error) {
            console.error(error);
            toast.error("Erreur lors du chargement des données.");
        } finally {
            setLoading(false);
        }
    };

    // --- ACTIONS ---

    const handleStatusChange = (eleveId, newStatus) => {
        setStatuses(prev => {
            const copy = { ...prev };
            if (!newStatus) delete copy[eleveId];
            else copy[eleveId] = newStatus;
            return copy;
        });
    };

    const ajouterInvite = () => {
        if (!selectedStudentId) return;
        const eleve = allStudents.find(e => e.id === selectedStudentId);
        if (!eleve) return;

        // Vérif doublon
        const estTitulaire = inscrits.some(e => e.id === eleve.id);
        const estDejaInvite = invites.some(e => e.id === eleve.id);

        if (estTitulaire || estDejaInvite) {
            toast.error("Cet élève est déjà dans la liste.");
            return;
        }

        setInvites([...invites, eleve]);
        setStatuses(prev => ({ ...prev, [eleve.id]: 'present' }));
        setGuestOrigins(prev => ({ ...prev, [eleve.id]: 'manual' }));
        setSelectedStudentId("");
        setIsAjoutManuel(false);
        toast.success(`${eleve.prenom} ajouté(e) !`);
    };

    // --- MODALES DE CONFIRMATION ---

    const triggerConfirm = (title, content, action, colorClass = "bg-red-500", confirmLabel = "Supprimer") => {
        setConfirmConfig({
            title,
            content: <p className="text-gray-600 text-sm">{content}</p>,
            colorClass,
            confirmLabel,
            onConfirm: async () => {
                await action();
                setConfirmConfig(null);
            }
        });
    };

    const supprimerInvite = (id) => {
        triggerConfirm(
            "Retirer l'invité ?",
            "Cela retirera cette personne de la séance. Si elle avait utilisé un crédit, vous devrez peut-être le gérer manuellement.",
            () => {
                setInvites(invites.filter(i => i.id !== id));
                setStatuses(prev => {
                    const copy = { ...prev };
                    delete copy[id];
                    return copy;
                });
                toast.success("Invité retiré.");
            },
            "bg-orange-500",
            "Retirer"
        );
    };

    const supprimerInscrit = (id) => {
        // Pour un titulaire, "supprimer" de la liste visuelle revient à ne pas gérer son statut ici,
        // mais normalement on change juste son statut à "absent".
        // Ici, on va proposer de le marquer ABSENT plutôt que de le supprimer de la liste.
        handleStatusChange(id, 'absent');
        toast("Marqué comme absent", { icon: '👋' });
    };

    const supprimerDuWaitingList = (id) => {
        triggerConfirm(
            "Retirer de la file d'attente ?",
            "La personne ne recevra plus de notification si une place se libère.",
            () => {
                setWaitingList(waitingList.filter(w => w.id !== id));
                toast.success("Retiré de la file d'attente.");
            },
            "bg-red-500",
            "Retirer"
        );
    };

    const basculerAnnulation = async () => {
        if (estAnnule) {
            // RESTAURER
            triggerConfirm(
                "Restaurer le cours ?",
                "Le cours réapparaîtra dans le planning des élèves.",
                async () => {
                    try {
                        if (annulationDocId) {
                            await deleteDoc(doc(db, "exceptions", annulationDocId));
                        }
                        setEstAnnule(false);
                        setAnnulationDocId(null);
                        onEdit(); // Rafraîchir planning parent
                        toast.success("Cours restauré !");
                    } catch (e) {
                        console.error(e);
                        toast.error("Erreur lors de la restauration.");
                    }
                },
                "bg-teal-600",
                "Restaurer"
            );
        } else {
            // ANNULER
            triggerConfirm(
                "Annuler ce cours ?",
                "Le cours disparaîtra du planning des élèves pour cette date uniquement.",
                async () => {
                    try {
                        const docRef = await addDoc(collection(db, "exceptions"), {
                            groupeId: groupe.id,
                            date: date,
                            type: "annulation"
                        });
                        setEstAnnule(true);
                        setAnnulationDocId(docRef.id);
                        onEdit();
                        toast.success("Cours annulé avec succès.");
                        onClose();
                    } catch (e) {
                        console.error(e);
                        toast.error("Erreur lors de l'annulation.");
                    }
                },
                "bg-red-600",
                "Confirmer l'annulation"
            );
        }
    };

    // --- SAUVEGARDE GLOBALE ---
    const sauvegarder = async () => {
        const toastId = toast.loading("Enregistrement...");
        try {
            const batch = writeBatch(db);
            const attendanceRef = doc(db, "attendance", seanceId);

            // 1. Calcul des changements de crédits (diff entre initialStatus et statuses)
            // C'est ici que réside la logique complexe des crédits côté Admin
            // Simplification : L'admin a toujours raison. On applique les règles standard.

            // A. Titulaires qui passent de 'rien/present' à 'absent' -> +1 crédit
            // B. Titulaires qui passent de 'absent' à 'present' -> -1 crédit
            // C. Invités (non titulaires) qui sont 'present' -> -1 crédit (si ajoutés manuellement)

            // NOTE : Pour l'instant, pour simplifier et ne pas faire de bêtises, 
            // on ne touche aux crédits QUE pour les invités manuels ajoutés lors de cette session d'édition.
            // Pour les titulaires, on suppose que l'admin gère les cas particuliers.
            // (Idéalement, il faudrait une logique robuste ici, mais c'est risqué sans historique).

            // Pour ce refactoring UX, on garde la logique "sauvegarde de l'état" simple.
            // On met à jour le document attendance.

            const finalStatus = { ...statuses };
            // Nettoyage des undefined
            Object.keys(finalStatus).forEach(key => {
                if (finalStatus[key] === undefined) delete finalStatus[key];
            });

            const waitingListIds = waitingList.map(w => w.id);

            // Mise à jour ou création du doc attendance
            batch.set(attendanceRef, {
                groupeId: groupe.id,
                nomGroupe: groupe.nom,
                date: date,
                realDate: Timestamp.fromDate(new Date(date)),
                status: finalStatus,
                waitingList: waitingListIds,
                replacementLinks: replacementLinks,
                updatedAt: serverTimestamp()
            }, { merge: true });

            // Gestion des crédits pour les NOUVEAUX invités manuels (ceux ajoutés à l'instant)
            // On regarde ceux qui ont origin 'manual'
            Object.keys(guestOrigins).forEach(guestId => {
                if (guestOrigins[guestId] === 'manual') {
                    // On débitera 1 crédit à ces gens-là car l'admin les a ajoutés manuellement
                    const userRef = doc(db, "eleves", guestId);
                    batch.update(userRef, { absARemplacer: increment(-1) });
                }
            });

            await batch.commit();

            // Mise à jour de l'état initial pour la prochaine fois
            setInitialStatus(JSON.parse(JSON.stringify(finalStatus)));
            setGuestOrigins({}); // Reset des origines manuelles traitées

            toast.success("Modifications enregistrées !", { id: toastId });
            onEdit(); // Rafraîchir le planning parent
            // On ne ferme pas forcément, on laisse l'admin décider

        } catch (e) {
            console.error(e);
            toast.error("Erreur lors de la sauvegarde.", { id: toastId });
        }
    };


    // --- RENDU ---

    if (loading) return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-white p-6 rounded-lg shadow-xl animate-pulse flex flex-col items-center">
                <div className="w-10 h-10 border-4 border-teal-600 border-t-transparent rounded-full animate-spin mb-4"></div>
                <p className="text-teal-800 font-bold">Chargement de la séance...</p>
            </div>
        </div>
    );

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>

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

            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>

                {/* HEADER */}
                <div className={`p-6 flex justify-between items-center ${estAnnule ? 'bg-gray-100 border-b border-gray-300' : 'bg-teal-900 text-white'}`}>
                    <div>
                        <div className="flex items-center gap-3">
                            <h2 className={`text-2xl font-bold font-playfair ${estAnnule ? 'text-gray-500 line-through' : ''}`}>
                                {groupe.nom}
                            </h2>
                            {estAnnule && <span className="bg-red-100 text-red-600 text-xs font-bold px-2 py-1 rounded border border-red-200 uppercase">Annulé</span>}
                        </div>
                        <p className={`text-sm mt-1 ${estAnnule ? 'text-gray-400' : 'text-teal-100'}`}>
                            {new Date(date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} • {groupe.heureDebut}
                        </p>
                    </div>
                    <div className="flex gap-3">
                        {/* Bouton Annulation */}
                        {!groupe.isExceptionnel && (
                            <button
                                onClick={basculerAnnulation}
                                className={`text-xs font-bold px-3 py-2 rounded border transition ${estAnnule ? 'bg-teal-600 text-white border-teal-600 hover:bg-teal-700' : 'bg-transparent text-red-300 border-red-300/50 hover:bg-red-900/20 hover:text-red-200'}`}
                            >
                                {estAnnule ? "Restaurer le cours" : "Annuler la séance"}
                            </button>
                        )}
                        <button onClick={onClose} className="bg-white/10 hover:bg-white/20 rounded-full w-10 h-10 flex items-center justify-center font-bold transition">✕</button>
                    </div>
                </div>

                {/* CONTENU PRINCIPAL */}
                <div className="flex-1 overflow-y-auto p-6 bg-gray-50">

                    {estAnnule ? (
                        <div className="text-center py-10 opacity-50">
                            <div className="text-6xl mb-4">🚫</div>
                            <h3 className="text-xl font-bold text-gray-800">Ce cours est annulé</h3>
                            <p className="text-gray-500">Aucun élève ne peut s'y inscrire.</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

                            {/* COLONNE GAUCHE : LISTE DES PRÉSENTS */}
                            <div className="space-y-6">
                                <div className="flex justify-between items-end">
                                    <h3 className="text-sm font-bold text-teal-900 uppercase tracking-wider border-b-2 border-teal-200 pb-1">
                                        Participants ({inscrits.filter(i => statuses[i.id] !== 'absent' && statuses[i.id] !== 'absent_announced').length + invites.length} / {groupe.places})
                                    </h3>

                                    {/* Ajout manuel */}
                                    <div className="relative">
                                        {!isAjoutManuel ? (
                                            <button
                                                onClick={() => setIsAjoutManuel(true)}
                                                className="text-xs font-bold text-purple-600 hover:bg-purple-50 px-2 py-1 rounded transition flex items-center gap-1"
                                            >
                                                + Ajouter un invité
                                            </button>
                                        ) : (
                                            <div className="flex items-center gap-1 bg-white p-1 rounded shadow-lg border absolute right-0 top-0 z-10 w-64">
                                                <select
                                                    className="text-xs border-none outline-none flex-1 bg-transparent p-1"
                                                    value={selectedStudentId}
                                                    onChange={e => setSelectedStudentId(e.target.value)}
                                                    autoFocus
                                                >
                                                    <option value="">Choisir un élève...</option>
                                                    {allStudents.map(s => (
                                                        <option key={s.id} value={s.id}>{s.nom} {s.prenom}</option>
                                                    ))}
                                                </select>
                                                <button onClick={ajouterInvite} className="text-green-600 font-bold px-2 hover:bg-green-50 rounded">OK</button>
                                                <button onClick={() => setIsAjoutManuel(false)} className="text-gray-400 font-bold px-2 hover:bg-gray-50 rounded">✕</button>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                                    {/* 1. TITULAIRES */}
                                    {inscrits.map(eleve => {
                                        const status = statuses[eleve.id];
                                        const isAbsent = status === 'absent' || status === 'absent_announced';

                                        return (
                                            <div key={eleve.id} className={`flex items-center justify-between p-3 border-b border-gray-100 last:border-0 hover:bg-gray-50 transition ${isAbsent ? 'bg-orange-50/50' : ''}`}>
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-2 h-2 rounded-full ${isAbsent ? 'bg-orange-300' : 'bg-teal-500'}`}></div>
                                                    <div>
                                                        <div className={`font-bold text-sm ${isAbsent ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
                                                            {eleve.nom} {eleve.prenom}
                                                        </div>
                                                        <div className="text-[10px] text-gray-400 uppercase font-bold tracking-wide">Titulaire</div>
                                                    </div>
                                                </div>

                                                <div className="flex items-center gap-2">
                                                    <select
                                                        value={isAbsent ? 'absent' : 'present'}
                                                        onChange={(e) => handleStatusChange(eleve.id, e.target.value === 'present' ? 'present' : 'absent')}
                                                        className={`text-xs font-bold rounded px-2 py-1 border-none focus:ring-0 cursor-pointer ${isAbsent ? 'text-orange-600 bg-orange-100' : 'text-teal-700 bg-teal-50'}`}
                                                    >
                                                        <option value="present">Présent</option>
                                                        <option value="absent">Absent</option>
                                                    </select>
                                                </div>
                                            </div>
                                        );
                                    })}

                                    {/* 2. INVITÉS */}
                                    {invites.map(eleve => (
                                        <div key={eleve.id} className="flex items-center justify-between p-3 border-b border-gray-100 last:border-0 bg-purple-50/30 hover:bg-purple-50 transition">
                                            <div className="flex items-center gap-3">
                                                <div className="w-2 h-2 rounded-full bg-purple-500"></div>
                                                <div>
                                                    <div className="font-bold text-sm text-gray-800">
                                                        {eleve.nom} {eleve.prenom}
                                                    </div>
                                                    <div className="text-[10px] text-purple-600 uppercase font-bold tracking-wide">Invité / Rattrapage</div>
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => supprimerInvite(eleve.id)}
                                                className="text-gray-400 hover:text-red-500 w-8 h-8 flex items-center justify-center rounded-full hover:bg-red-50 transition"
                                                title="Retirer"
                                            >
                                                ✕
                                            </button>
                                        </div>
                                    ))}

                                    {inscrits.length === 0 && invites.length === 0 && (
                                        <div className="p-8 text-center text-gray-400 italic text-sm">
                                            Aucun participant pour le moment.
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* COLONNE DROITE : LISTE D'ATTENTE */}
                            <div className="space-y-6">
                                <h3 className="text-sm font-bold text-orange-800 uppercase tracking-wider border-b-2 border-orange-200 pb-1">
                                    Liste d'attente ({waitingList.length})
                                </h3>

                                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                                    {waitingList.map((eleve, index) => (
                                        <div key={eleve.id} className="flex items-center justify-between p-3 border-b border-gray-100 last:border-0 hover:bg-gray-50 transition">
                                            <div className="flex items-center gap-3">
                                                <span className="font-mono text-orange-400 font-bold text-lg w-6">{index + 1}.</span>
                                                <div>
                                                    <div className="font-bold text-sm text-gray-800">
                                                        {eleve.nom} {eleve.prenom}
                                                    </div>
                                                    <div className="text-[10px] text-gray-400">En attente</div>
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => supprimerDuWaitingList(eleve.id)}
                                                className="text-gray-400 hover:text-red-500 w-8 h-8 flex items-center justify-center rounded-full hover:bg-red-50 transition"
                                                title="Retirer"
                                            >
                                                ✕
                                            </button>
                                        </div>
                                    ))}
                                    {waitingList.length === 0 && (
                                        <div className="p-8 text-center text-orange-200 italic text-sm">
                                            Personne sur liste d'attente.
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* FOOTER */}
                <div className="p-5 bg-white border-t flex justify-end gap-4 z-40">
                    <button onClick={onClose} className="px-5 py-2.5 text-gray-500 font-bold hover:bg-gray-100 rounded-lg transition">Fermer</button>
                    {!estAnnule && (
                        <button
                            onClick={sauvegarder}
                            className="bg-teal-700 text-white px-8 py-2.5 rounded-lg font-bold hover:bg-teal-800 shadow-lg transform active:scale-95 transition flex items-center gap-2"
                        >
                            <span>Enregistrer</span>
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}