import { useState, useEffect } from 'react';
import { db } from './firebase';
import {
    collection,
    getDocs,
    doc,
    getDoc,
    writeBatch,
    increment,
    deleteDoc,
    setDoc,
    serverTimestamp,
    Timestamp,
    deleteField
} from 'firebase/firestore';

export default function GestionSeance({ groupe, date, onClose, onEdit }) {
    const [inscrits, setInscrits] = useState([]);
    const [invites, setInvites] = useState([]);
    const [waitingList, setWaitingList] = useState([]);
    const [allStudents, setAllStudents] = useState([]);

    const [statuses, setStatuses] = useState({});
    const [initialStatus, setInitialStatus] = useState({});

    // Liens : Qui remplace qui ? { [guestId]: titulaireId }
    const [replacementLinks, setReplacementLinks] = useState({});
    // Origines : D'où vient l'invité ? { [guestId]: 'waiting' | 'manual' }
    const [guestOrigins, setGuestOrigins] = useState({});

    const [loading, setLoading] = useState(true);
    const [estAnnule, setEstAnnule] = useState(false);

    // États pour les sélecteurs
    const [targetAbsentId, setTargetAbsentId] = useState(null); // ID du titulaire à remplacer
    const [selectedStudentId, setSelectedStudentId] = useState(""); // Pour ajout remplacement/surnombre
    const [selectedWaitlistId, setSelectedWaitlistId] = useState(""); // Pour ajout file d'attente

    // IDs
    const dateStr = date.toLocaleDateString('fr-CA');
    const seanceId = `${dateStr}_${groupe.id}`;
    const exceptionId = `${dateStr}_${groupe.id}_CANCEL`;

    useEffect(() => {
        chargerDonnees();
    }, []);

    const chargerDonnees = async () => {
        try {
            if (groupe.type === 'standard') {
                const exceptionDoc = await getDoc(doc(db, "exceptions", exceptionId));
                setEstAnnule(exceptionDoc.exists());
            }

            const elevesSnapshot = await getDocs(collection(db, "eleves"));
            const tous = elevesSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            tous.sort((a, b) => a.nom.localeCompare(b.nom));
            setAllStudents(tous);

            const attendanceDoc = await getDoc(doc(db, "attendance", seanceId));
            let savedStatus = {};
            let savedReplacementLinks = {};
            let savedGuestOrigins = {};
            let savedGuestIds = [];
            let savedWaitingIds = [];

            if (attendanceDoc.exists()) {
                const data = attendanceDoc.data();
                savedStatus = data.status || {};
                savedReplacementLinks = data.replacementLinks || {};
                savedGuestOrigins = data.guestOrigins || {};
                savedWaitingIds = data.waitingList || [];

                savedGuestIds = Object.keys(savedStatus).filter(id => {
                    const student = tous.find(s => s.id === id);
                    return student && (!student.enrolledGroupIds || !student.enrolledGroupIds.includes(groupe.id));
                });
            }

            const listeInscrits = tous.filter(e => e.enrolledGroupIds && e.enrolledGroupIds.includes(groupe.id));
            const listeInvites = savedGuestIds.map(id => tous.find(s => s.id === id)).filter(Boolean);
            const listeAttente = savedWaitingIds.map(id => tous.find(s => s.id === id)).filter(Boolean);

            setInscrits(listeInscrits);
            setInvites(listeInvites);
            setWaitingList(listeAttente);
            setReplacementLinks(savedReplacementLinks);
            setGuestOrigins(savedGuestOrigins);

            const finalStatus = { ...savedStatus };
            listeInscrits.forEach(e => {
                if (!finalStatus[e.id]) finalStatus[e.id] = 'present';
            });
            listeInvites.forEach(e => {
                if (!finalStatus[e.id]) finalStatus[e.id] = 'present';
            });

            setStatuses(finalStatus);
            setInitialStatus(JSON.parse(JSON.stringify(finalStatus)));

        } catch (error) {
            console.error("Erreur chargement:", error);
        } finally {
            setLoading(false);
        }
    };

    const toggleStatus = (eleveId) => {
        const newStatus = statuses[eleveId] === 'present' ? 'absent' : 'present';

        setStatuses(prev => ({
            ...prev,
            [eleveId]: newStatus
        }));

        // Si le titulaire revient (Présent), on casse le lien avec son remplaçant éventuel
        if (newStatus === 'present') {
            const guestIdLinked = Object.keys(replacementLinks).find(key => replacementLinks[key] === eleveId);
            if (guestIdLinked) {
                const newLinks = { ...replacementLinks };
                delete newLinks[guestIdLinked];
                setReplacementLinks(newLinks);
            }
        }
    };

    // --- ACTIONS PRINCIPALES ---

    // 1. Ajouter un invité (Remplacement ou Surnombre)
    const validerAjoutInvite = () => {
        if (!selectedStudentId) return;
        const eleve = allStudents.find(e => e.id === selectedStudentId);
        if (!eleve) return;

        // Est-ce qu'il vient de la file d'attente ? (Soit sélectionné ici, soit détecté dans la liste actuelle)
        const vientDeFileAttente = waitingList.find(w => w.id === eleve.id);

        // Ajout aux listes
        setInvites(prev => [...prev, eleve]);
        setStatuses(prev => ({ ...prev, [eleve.id]: 'present' }));

        // Retrait de la file d'attente si présent
        if (vientDeFileAttente) {
            setWaitingList(prev => prev.filter(w => w.id !== eleve.id));
            // On note l'origine "waiting"
            setGuestOrigins(prev => ({ ...prev, [eleve.id]: 'waiting' }));
        } else {
            // Sinon origine "manual"
            setGuestOrigins(prev => ({ ...prev, [eleve.id]: 'manual' }));
        }

        // Création du lien si c'était un remplacement ciblé
        if (targetAbsentId) {
            setReplacementLinks(prev => ({ ...prev, [eleve.id]: targetAbsentId }));
        }

        // Reset
        setTargetAbsentId(null);
        setSelectedStudentId("");
    };

    // 2. Retirer un invité
    const retirerInvite = (eleveId) => {
        const origine = guestOrigins[eleveId];
        const message = origine === 'waiting'
            ? "Retirer cet élève ? Il retournera dans la file d'attente."
            : "Retirer cet élève définitivement de la séance ?";

        if (confirm(message)) {
            const eleve = invites.find(i => i.id === eleveId);

            // Suppression visuelle
            setInvites(prev => prev.filter(e => e.id !== eleveId));
            const newStatuses = { ...statuses };
            delete newStatuses[eleveId];
            setStatuses(newStatuses);

            // Nettoyage des liens/origines
            const newLinks = { ...replacementLinks };
            delete newLinks[eleveId];
            setReplacementLinks(newLinks);

            const newOrigins = { ...guestOrigins };
            delete newOrigins[eleveId];
            setGuestOrigins(newOrigins);

            // LOGIQUE DE RETOUR FILE D'ATTENTE
            if (origine === 'waiting' && eleve) {
                // On vérifie qu'il n'y est pas déjà pour éviter les doublons
                if (!waitingList.some(w => w.id === eleve.id)) {
                    setWaitingList(prev => [...prev, eleve]);
                }
            }
        }
    };

    // 3. Gestion File d'Attente (Ajout/Suppression)
    const ajouterAuWaitingList = () => {
        if (!selectedWaitlistId) return;
        if (waitingList.find(w => w.id === selectedWaitlistId)) return;

        const eleve = allStudents.find(e => e.id === selectedWaitlistId);
        if (eleve) {
            setWaitingList(prev => [...prev, eleve]);
            setSelectedWaitlistId("");
        }
    };

    const supprimerDuWaitingList = (eleveId) => {
        if (confirm("Supprimer de la file d'attente ?")) {
            setWaitingList(prev => prev.filter(w => w.id !== eleveId));
        }
    };

    // 4. Raccourci "Promouvoir" depuis la file d'attente
    const promouvoirDepuisWaiting = (eleve) => {
        // On simule une sélection et une validation
        setSelectedStudentId(eleve.id);
        // On doit le faire dans un useEffect ou appeler directement la logique
        // Pour simplifier, on reproduit la logique de validerAjoutInvite ici :

        setInvites(prev => [...prev, eleve]);
        setStatuses(prev => ({ ...prev, [eleve.id]: 'present' }));
        setWaitingList(prev => prev.filter(w => w.id !== eleve.id));
        setGuestOrigins(prev => ({ ...prev, [eleve.id]: 'waiting' }));
        setSelectedStudentId(""); // Nettoyage au cas où
    };


    // --- SAUVEGARDE ---
    const sauvegarder = async () => {
        setLoading(true);
        try {
            const batch = writeBatch(db);
            const attendanceRef = doc(db, "attendance", seanceId);
            const statusToSave = { ...statuses };

            Object.keys(initialStatus).forEach(id => {
                if (statuses[id] === undefined) {
                    statusToSave[id] = deleteField();
                }
            });

            batch.set(attendanceRef, {
                date: dateStr,
                groupeId: groupe.id,
                nomGroupe: groupe.nom,
                realDate: Timestamp.fromDate(date),
                status: statusToSave,
                waitingList: waitingList.map(e => e.id),
                replacementLinks: replacementLinks,
                guestOrigins: guestOrigins, // On sauvegarde l'origine !
                updatedAt: serverTimestamp()
            }, { merge: true });

            // Calcul Crédits
            const allInvolvedIds = new Set([
                ...Object.keys(initialStatus),
                ...Object.keys(statuses)
            ]);

            allInvolvedIds.forEach(eleveId => {
                const oldVal = initialStatus[eleveId];
                const newVal = statuses[eleveId];
                const effectiveNewVal = newVal || 'removed';

                if (oldVal === effectiveNewVal) return;

                const estInscrit = inscrits.some(e => e.id === eleveId);
                let creditChange = 0;

                if (estInscrit) {
                    if (effectiveNewVal === 'absent' && oldVal !== 'absent') creditChange = 1;
                    else if (effectiveNewVal === 'present' && oldVal === 'absent') creditChange = -1;
                } else {
                    if (effectiveNewVal === 'present' && oldVal !== 'present') creditChange = -1;
                    else if (effectiveNewVal !== 'present' && oldVal === 'present') creditChange = 1;
                }

                if (creditChange !== 0) {
                    const eleveRef = doc(db, "eleves", eleveId);
                    batch.update(eleveRef, { absARemplacer: increment(creditChange) });
                }
            });

            await batch.commit();
            alert("Modifications enregistrées ! ✅");
            onClose();

        } catch (error) {
            console.error(error);
            alert("Erreur : " + error.message);
        } finally {
            setLoading(false);
        }
    };

    const handleCancelOrDelete = async () => {
        if (groupe.type === 'ajout') {
            if (confirm("Voulez-vous SUPPRIMER définitivement cette séance ?")) {
                await deleteDoc(doc(db, "exceptions", groupe.originalExceptionId));
                onClose();
            }
        } else {
            if (confirm(`Voulez-vous vraiment ANNULER le cours du ${date.toLocaleDateString()} ?`)) {
                await setDoc(doc(db, "exceptions", exceptionId), { date: dateStr, groupeId: groupe.id, type: "annulation" });
                onClose();
            }
        }
    };

    const retablirLeCours = async () => {
        if (confirm(`Voulez-vous RÉTABLIR ce cours ?`)) {
            await deleteDoc(doc(db, "exceptions", exceptionId));
            onClose();
        }
    };

    // Stats
    const nbTitulairesPresents = inscrits.filter(e => statuses[e.id] === 'present').length;
    const nbInvites = invites.length;
    const totalPresents = nbTitulairesPresents + nbInvites;
    const isOver = totalPresents > groupe.places;

    if (loading) return <div className="fixed inset-0 bg-black/80 flex text-white items-center justify-center z-50">Chargement...</div>;

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[95vh] relative">

                {/* HEADER */}
                <div className={`p-6 text-white flex justify-between items-start ${estAnnule ? 'bg-gray-600' : 'bg-teal-900'}`}>
                    <div>
                        <h2 className="text-2xl font-bold font-playfair">
                            {groupe.nom}
                            {estAnnule && <span className="ml-3 text-sm bg-red-500 text-white px-2 py-1 rounded uppercase">Annulé</span>}
                        </h2>
                        <p className="text-teal-100 mt-1 capitalize">
                            {date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} • {groupe.heureDebut}
                        </p>
                    </div>
                    <button onClick={onClose} className="bg-white/20 hover:bg-white/40 text-white rounded-full w-10 h-10 flex items-center justify-center font-bold text-xl backdrop-blur-sm">✕</button>
                </div>

                {/* DASHBOARD CAPACITÉ */}
                {!estAnnule && (
                    <div className="bg-gray-50 border-b p-4">
                        <div className="flex justify-between items-end mb-1">
                            <span className="text-xs font-bold text-gray-500 uppercase">Taux de remplissage</span>
                            <span className={`text-sm font-bold ${isOver ? 'text-red-600' : 'text-gray-800'}`}>
                                {totalPresents} / {groupe.places} participants
                            </span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2.5">
                            <div
                                className={`h-2.5 rounded-full transition-all duration-500 ${isOver ? 'bg-red-500' : 'bg-teal-500'}`}
                                style={{ width: `${Math.min((totalPresents / groupe.places) * 100, 100)}%` }}
                            ></div>
                        </div>
                        {isOver && <p className="text-xs text-red-500 mt-1 font-bold text-right">⚠️ Surbooking (+{totalPresents - groupe.places})</p>}
                    </div>
                )}

                {/* CONTENU */}
                <div className="flex-1 overflow-y-auto p-4 bg-gray-100 space-y-4">

                    {estAnnule ? (
                        <div className="flex flex-col items-center justify-center h-64 text-gray-500">
                            <div className="text-4xl mb-4">🚫</div>
                            <p className="text-lg">Ce cours est annulé.</p>
                        </div>
                    ) : (
                        <>
                            {/* --- 1. LISTE TITULAIRES --- */}
                            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                                <div className="bg-teal-50 px-4 py-3 border-b border-teal-100 flex justify-between items-center">
                                    <h3 className="text-sm font-bold text-teal-900 uppercase tracking-wider">Titulaires</h3>
                                    <span className="text-xs font-bold bg-white text-teal-800 px-2 py-0.5 rounded-full border border-teal-100">
                                        {inscrits.length}
                                    </span>
                                </div>

                                <div className="divide-y divide-gray-50">
                                    {inscrits.map(eleve => {
                                        const isPresent = statuses[eleve.id] === 'present';

                                        // Recherche du remplaçant lié
                                        const replacementGuestId = Object.keys(replacementLinks).find(guestId => replacementLinks[guestId] === eleve.id);
                                        const replacementGuest = replacementGuestId ? invites.find(i => i.id === replacementGuestId) : null;

                                        return (
                                            <div key={eleve.id} className="relative transition-all">
                                                {/* Ligne Titulaire */}
                                                <div className={`p-3 flex items-center justify-between ${!isPresent ? 'bg-gray-50/50' : ''}`}>
                                                    <div className="flex items-center gap-3" onClick={() => toggleStatus(eleve.id)}>
                                                        <div className={`cursor-pointer w-3 h-3 rounded-full ${isPresent ? 'bg-teal-500' : 'bg-transparent border-2 border-gray-300 border-dashed'}`}></div>
                                                        <div className={`cursor-pointer ${!isPresent ? 'opacity-50' : ''}`}>
                                                            <div className="font-bold text-gray-800 text-sm">{eleve.nom} {eleve.prenom}</div>
                                                            <div className="text-xs text-gray-400">{isPresent ? 'Titulaire' : '❌ Absent'}</div>
                                                        </div>
                                                    </div>

                                                    <div className="flex items-center gap-2">
                                                        {/* Bouton Remplacer (+) */}
                                                        {!isPresent && !replacementGuest && (
                                                            <button
                                                                onClick={() => setTargetAbsentId(eleve.id)}
                                                                className="text-xs font-bold bg-purple-100 text-purple-700 w-8 h-8 rounded-full flex items-center justify-center hover:bg-purple-200 border border-purple-200 shadow-sm"
                                                                title="Ajouter un remplaçant pour cette place"
                                                            >
                                                                +
                                                            </button>
                                                        )}

                                                        <button
                                                            onClick={() => toggleStatus(eleve.id)}
                                                            className={`text-xs font-bold px-3 py-1.5 rounded transition-all ${isPresent ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-teal-50 text-teal-600 hover:bg-teal-100'}`}
                                                        >
                                                            {isPresent ? 'Absent' : 'Présent'}
                                                        </button>
                                                    </div>
                                                </div>

                                                {/* Ligne Remplaçant Lié */}
                                                {!isPresent && replacementGuest && (
                                                    <div className="ml-6 pl-4 border-l-2 border-purple-200 mb-2 py-1 pr-2 bg-purple-50/50 rounded-r-lg flex justify-between items-center animate-in fade-in slide-in-from-top-1">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-purple-400 text-lg">↳</span>
                                                            <div>
                                                                <div className="font-bold text-purple-900 text-sm">{replacementGuest.nom} {replacementGuest.prenom}</div>
                                                                <div className="text-[10px] text-purple-600 font-bold uppercase">Remplaçant</div>
                                                            </div>
                                                        </div>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); retirerInvite(replacementGuest.id); }}
                                                            className="w-6 h-6 flex items-center justify-center bg-white text-purple-300 hover:text-red-500 rounded-full hover:bg-red-50 shadow-sm"
                                                        >
                                                            ✕
                                                        </button>
                                                    </div>
                                                )}

                                                {/* Zone Sélection pour Remplacement Ciblé */}
                                                {!isPresent && targetAbsentId === eleve.id && (
                                                    <div className="ml-6 p-2 bg-purple-100 rounded-lg mb-2 animate-in zoom-in-95 border border-purple-300">
                                                        <div className="text-xs font-bold text-purple-800 mb-1">Qui remplace {eleve.prenom} ?</div>
                                                        <div className="flex gap-2">
                                                            <select
                                                                autoFocus
                                                                className="flex-1 text-sm border-gray-300 rounded focus:ring-purple-500"
                                                                value={selectedStudentId}
                                                                onChange={(e) => setSelectedStudentId(e.target.value)}
                                                            >
                                                                <option value="">-- Choisir un élève --</option>
                                                                {allStudents
                                                                    .filter(s => !inscrits.find(i => i.id === s.id) && !invites.find(i => i.id === s.id))
                                                                    .map(s => (
                                                                        <option key={s.id} value={s.id}>
                                                                            {s.nom} {s.prenom} ({s.absARemplacer} Cr.)
                                                                        </option>
                                                                    ))}
                                                            </select>
                                                            <button onClick={validerAjoutInvite} className="bg-purple-600 text-white px-3 py-1 rounded font-bold text-xs">OK</button>
                                                            <button onClick={() => setTargetAbsentId(null)} className="text-gray-500 px-2 text-xs">Annuler</button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* --- 2. SURNOMBRE (Invités non liés) --- */}
                            {invites.filter(i => !replacementLinks[i.id]).length > 0 && (
                                <div className="bg-purple-100 rounded-xl shadow-sm border border-purple-200 overflow-hidden">
                                    <div className="px-4 py-2 border-b border-purple-200 flex justify-between items-center">
                                        <h3 className="text-xs font-bold text-purple-900 uppercase tracking-wider">Surnombre (Hors Créneaux)</h3>
                                    </div>
                                    <div className="p-3 space-y-2">
                                        {invites.filter(i => !replacementLinks[i.id]).map(eleve => (
                                            <div key={eleve.id} className="flex items-center justify-between bg-white p-2 rounded-lg border border-purple-100 shadow-sm">
                                                <div className="flex items-center gap-3">
                                                    <span className="text-lg">➕</span>
                                                    <div>
                                                        <div className="font-bold text-gray-800 text-sm">{eleve.nom} {eleve.prenom}</div>
                                                        <div className="text-xs text-purple-500">Ajout Surnombre</div>
                                                    </div>
                                                </div>
                                                <button onClick={() => retirerInvite(eleve.id)} className="text-gray-400 hover:text-red-500 px-2">✕</button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* BOUTON AJOUT SURNOMBRE (Toujours visible si pas de cible) */}
                            {!targetAbsentId && (
                                <div className="bg-gray-200 p-3 rounded-xl border border-gray-300">
                                    <div className="text-xs font-bold text-gray-600 mb-2 uppercase">Ajouter un élève en surnombre</div>
                                    <div className="flex gap-2">
                                        <select
                                            className="flex-1 text-sm border-gray-300 rounded-lg"
                                            value={selectedStudentId}
                                            onChange={(e) => setSelectedStudentId(e.target.value)}
                                        >
                                            <option value="">+ Choisir un élève</option>
                                            {allStudents
                                                .filter(s => !inscrits.find(i => i.id === s.id) && !invites.find(i => i.id === s.id))
                                                .map(s => (
                                                    <option key={s.id} value={s.id}>{s.nom} {s.prenom}</option>
                                                ))}
                                        </select>
                                        <button
                                            onClick={validerAjoutInvite}
                                            disabled={!selectedStudentId}
                                            className="bg-gray-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-gray-700 disabled:opacity-50"
                                        >
                                            Ajouter
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* --- 3. GESTION FILE D'ATTENTE --- */}
                            <div className="bg-orange-50 rounded-xl border border-orange-200 overflow-hidden mt-4">
                                <div className="px-4 py-2 bg-orange-100 border-b border-orange-200 text-orange-800 font-bold text-xs uppercase flex justify-between">
                                    <span>🕒 File d'attente ({waitingList.length})</span>
                                </div>

                                <div className="p-3 space-y-2">
                                    {waitingList.length === 0 && <p className="text-xs text-orange-400 italic text-center">Personne en attente.</p>}

                                    {waitingList.map(eleve => (
                                        <div key={eleve.id} className="flex justify-between items-center bg-white p-2 rounded border border-orange-100">
                                            <span className="text-sm text-gray-700 font-medium">{eleve.nom} {eleve.prenom}</span>
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => promouvoirDepuisWaiting(eleve)}
                                                    className="text-[10px] bg-green-100 text-green-700 px-2 py-1 rounded font-bold hover:bg-green-200"
                                                >
                                                    PROMOUVOIR
                                                </button>
                                                <button
                                                    onClick={() => supprimerDuWaitingList(eleve.id)}
                                                    className="text-gray-400 hover:text-red-500 px-1"
                                                >
                                                    ✕
                                                </button>
                                            </div>
                                        </div>
                                    ))}

                                    {/* Ajout manuel dans la file d'attente */}
                                    <div className="flex gap-2 mt-2 pt-2 border-t border-orange-100">
                                        <select
                                            className="flex-1 text-sm border-orange-200 rounded-lg bg-orange-50/50 focus:ring-orange-500"
                                            value={selectedWaitlistId}
                                            onChange={(e) => setSelectedWaitlistId(e.target.value)}
                                        >
                                            <option value="">+ Ajouter en file d'attente</option>
                                            {allStudents
                                                .filter(s => !inscrits.find(i => i.id === s.id) && !invites.find(i => i.id === s.id) && !waitingList.find(w => w.id === s.id))
                                                .map(s => (
                                                    <option key={s.id} value={s.id}>{s.nom} {s.prenom}</option>
                                                ))}
                                        </select>
                                        <button
                                            onClick={ajouterAuWaitingList}
                                            disabled={!selectedWaitlistId}
                                            className="bg-orange-400 text-white px-3 py-1 rounded-lg text-xs font-bold hover:bg-orange-500 disabled:opacity-50"
                                        >
                                            OK
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}
                </div>

                {/* FOOTER ACTIONS */}
                <div className="p-4 bg-white border-t flex justify-between items-center z-10">
                    <div className="flex items-center gap-2">
                        {!estAnnule && groupe.type === 'ajout' && (
                            <button onClick={() => onEdit(groupe)} className="text-blue-600 font-bold text-sm underline px-2">✏️ Modifier</button>
                        )}
                        {!estAnnule && (
                            <button onClick={handleCancelOrDelete} className="text-red-400 hover:text-red-600 font-bold text-xs underline px-2">
                                {groupe.type === 'ajout' ? 'Supprimer' : 'Annuler ce cours'}
                            </button>
                        )}
                        {estAnnule && <button onClick={retablirLeCours} className="text-teal-600 font-bold text-sm underline px-2">↩ Rétablir</button>}
                    </div>
                    <div className="flex gap-3">
                        <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-gray-500 hover:text-gray-700">Fermer</button>
                        {!estAnnule && (
                            <button onClick={sauvegarder} className="bg-teal-700 text-white px-6 py-2 rounded-lg font-bold hover:bg-teal-800 shadow-md">
                                Enregistrer
                            </button>
                        )}
                    </div>
                </div>

            </div>
        </div>
    );
}