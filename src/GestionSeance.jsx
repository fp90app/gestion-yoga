import { useState, useEffect, useRef } from 'react';
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
import toast from 'react-hot-toast';
import ConfirmModal from './components/ConfirmModal';

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
    const motifRef = useRef(""); // Référence pour le motif d'annulation

    // --- SÉLECTEURS ---
    const [addMode, setAddMode] = useState(null);
    const [targetSlotId, setTargetSlotId] = useState(null);
    const [selectedStudentId, setSelectedStudentId] = useState("");
    const [selectedWaitlistId, setSelectedWaitlistId] = useState("");

    const isExceptionnel = groupe.type === 'ajout';

    // FORMATAGE DE L'ID
    const dateStr = date.toLocaleDateString('fr-CA');
    const seanceId = isExceptionnel ? groupe.id : `${dateStr}_${groupe.id}`;

    useEffect(() => {
        chargerDonnees();
    }, []);

    const chargerDonnees = async () => {
        try {
            // 1. Vérif Annulation
            if (!isExceptionnel) {
                const q = query(
                    collection(db, "exceptions"),
                    where("groupeId", "==", groupe.id),
                    where("date", "==", dateStr),
                    where("type", "==", "annulation")
                );
                const exSnap = await getDocs(q);
                if (!exSnap.empty) {
                    setEstAnnule(true);
                    setAnnulationDocId(exSnap.docs[0].id);
                } else {
                    setEstAnnule(false);
                    setAnnulationDocId(null);
                }
            }

            // 2. Charger TOUS les élèves
            const elevesSnapshot = await getDocs(collection(db, "eleves"));
            const tous = elevesSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            tous.sort((a, b) => a.nom.localeCompare(b.nom));
            setAllStudents(tous);

            // 3. Charger l'Attendance
            const attendanceDoc = await getDoc(doc(db, "attendance", seanceId));

            let savedStatus = {};
            let savedReplacementLinks = {};
            let savedGuestOrigins = {};
            let savedWaitingIds = [];

            if (attendanceDoc.exists()) {
                const data = attendanceDoc.data();
                savedStatus = data.status || {};
                savedReplacementLinks = data.replacementLinks || {};
                savedGuestOrigins = data.guestOrigins || {};
                savedWaitingIds = data.waitingList || [];
            }

            // A. Identification des TITULAIRES
            const listeInscrits = isExceptionnel
                ? []
                : tous.filter(e => e.enrolledGroupIds && e.enrolledGroupIds.includes(groupe.id));

            // B. Identification des INVITÉS
            const presentIds = Object.keys(savedStatus).filter(k => savedStatus[k] === 'present');
            const guestIds = presentIds.filter(pid => !listeInscrits.some(i => i.id === pid));

            const listeInvites = guestIds.map(id => {
                const found = tous.find(s => s.id === id);
                return found || { id: id, nom: 'Inconnu', prenom: 'Utilisateur', absARemplacer: 0 };
            });

            // C. File d'attente
            const listeAttente = savedWaitingIds.map(id => tous.find(s => s.id === id)).filter(Boolean);

            setInscrits(listeInscrits);
            setInvites(listeInvites);
            setWaitingList(listeAttente);
            setReplacementLinks(savedReplacementLinks);
            setGuestOrigins(savedGuestOrigins);

            const finalStatus = { ...savedStatus };
            setStatuses(finalStatus);
            setInitialStatus(JSON.parse(JSON.stringify(finalStatus)));

        } catch (error) {
            console.error("Erreur chargement:", error);
            toast.error("Erreur chargement données");
        } finally {
            setLoading(false);
        }
    };

    // --- ACTIONS ADMIN ---

    const triggerConfirm = (title, content, action, colorClass = "bg-red-500", confirmLabel = "Confirmer") => {
        setConfirmConfig({
            title,
            content, // Content peut maintenant être du JSX
            colorClass,
            confirmLabel,
            onConfirm: async () => {
                await action();
                setConfirmConfig(null);
            }
        });
    };

    const handleAnnulerUnique = async () => {
        motifRef.current = ""; // Reset du motif
        // On passe du JSX dans le content pour inclure l'input
        const contentJsx = (
            <div className="space-y-3">
                <p className="text-gray-600 text-sm">Les élèves ne verront plus ce cours.</p>
                <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1">Motif (optionnel)</label>
                    <input
                        type="text"
                        placeholder="ex: Vacances, Maladie, Férié..."
                        className="w-full border p-2 rounded text-sm focus:ring-2 focus:ring-red-200 outline-none"
                        onChange={(e) => motifRef.current = e.target.value}
                    />
                </div>
            </div>
        );

        triggerConfirm("Annuler la séance ?", contentJsx, async () => {
            setLoading(true);
            await addDoc(collection(db, "exceptions"), {
                date: dateStr,
                groupeId: groupe.id,
                type: "annulation",
                motif: motifRef.current // Enregistrement du motif
            });
            await chargerDonnees();
            toast.success("Séance annulée");
        }, "bg-red-600", "Annuler la séance");
    };

    const handleRetablir = async () => {
        // Pour rétablir, on passe juste du texte simple
        triggerConfirm("Rétablir la séance ?", <p className="text-gray-600 text-sm">Le cours réapparaîtra dans le planning.</p>, async () => {
            setLoading(true);
            await deleteDoc(doc(db, "exceptions", annulationDocId));
            await chargerDonnees();
            toast.success("Séance rétablie");
        }, "bg-green-600", "Rétablir");
    };

    const handleSupprimerDefinitif = async () => {
        const msg = isExceptionnel ? "Supprimer cette séance unique ?" : "Supprimer TOUT le cours récurrent ?";
        triggerConfirm("Suppression Définitive", <p className="text-gray-600 text-sm">{msg}</p>, async () => {
            setLoading(true);
            const collectionName = isExceptionnel ? "exceptions" : "groupes";
            const docId = isExceptionnel ? (groupe.originalExceptionId || groupe.id) : groupe.id;
            await deleteDoc(doc(db, collectionName, docId));
            onClose();
            window.location.reload();
        }, "bg-red-700", "Supprimer définitivement");
    };

    // --- LOGIQUE PRESENCE ---
    const toggleStatus = (eleveId) => {
        const currentStatus = statuses[eleveId];
        const isCurrentlyAbsent = currentStatus === 'absent' || currentStatus === 'absent_announced';
        const newStatus = isCurrentlyAbsent ? 'present' : 'absent';

        if (newStatus === 'present') {
            const nbPresents = inscrits.filter(i => {
                if (i.id === eleveId) return true;
                const s = statuses[i.id];
                return s !== 'absent' && s !== 'absent_announced';
            }).length + invites.length;

            const placesTotales = typeof groupe.places === 'number' ? groupe.places : 10;

            if (nbPresents > placesTotales) {
                if (!confirm(`⚠️ Cours complet (${placesTotales} places).\nAjouter en SURNOMBRE ?`)) return;
            }

            const guestIdLinked = Object.keys(replacementLinks).find(key => replacementLinks[key] === eleveId);
            if (guestIdLinked) {
                const newLinks = { ...replacementLinks };
                delete newLinks[guestIdLinked];
                setReplacementLinks(newLinks);
            }
        }
        setStatuses(prev => ({ ...prev, [eleveId]: newStatus }));
    };

    const preparerAjout = (mode, targetId = null) => {
        setAddMode(mode);
        setTargetSlotId(targetId);
        setSelectedStudentId("");
    };

    const validerAjout = async () => {
        if (!selectedStudentId) return;
        const eleve = allStudents.find(e => e.id === selectedStudentId);
        if (!eleve) return;

        if (addMode === 'permanent') {
            if (isExceptionnel) { toast.error("Impossible sur séance unique."); return; }
            triggerConfirm("Inscription Annuelle", <p className="text-gray-600 text-sm">Inscrire {eleve.prenom} définitivement à ce créneau ?</p>, async () => {
                await updateDoc(doc(db, "eleves", eleve.id), { enrolledGroupIds: arrayUnion(groupe.id) });
                chargerDonnees();
                setAddMode(null);
                toast.success("Inscrit à l'année !");
            }, "bg-teal-600", "Inscrire");
            return;
        }

        const vientDeFileAttente = waitingList.find(w => w.id === eleve.id);
        if (vientDeFileAttente) {
            setWaitingList(prev => prev.filter(w => w.id !== eleve.id));
            setGuestOrigins(prev => ({ ...prev, [eleve.id]: 'waiting' }));
        } else {
            setGuestOrigins(prev => ({ ...prev, [eleve.id]: 'manual' }));
        }

        setInvites(prev => [...prev, eleve]);
        setStatuses(prev => ({ ...prev, [eleve.id]: 'present' }));

        if (addMode === 'replace' && targetSlotId) {
            setReplacementLinks(prev => ({ ...prev, [eleve.id]: targetSlotId }));
        }

        setAddMode(null);
        setTargetSlotId(null);
        setSelectedStudentId("");
        toast.success("Invité ajouté");
    };

    const desinscrireTitulaire = (eleve) => {
        triggerConfirm("Désinscrire ce titulaire ?",
            <p className="text-gray-600 text-sm">Cela retirera {eleve.prenom} de la liste des inscrits à l'année pour ce cours.</p>,
            async () => {
                const batch = writeBatch(db);
                batch.update(doc(db, "eleves", eleve.id), { enrolledGroupIds: arrayRemove(groupe.id) });
                batch.update(doc(db, "attendance", seanceId), {
                    [`status.${eleve.id}`]: deleteField(),
                    [`replacementLinks.${eleve.id}`]: deleteField()
                });
                await batch.commit();

                const newStatuses = { ...statuses };
                delete newStatuses[eleve.id];
                setStatuses(newStatuses);
                setInscrits(prev => prev.filter(i => i.id !== eleve.id));
                toast.success("Titulaire désinscrit");
            },
            "bg-red-600", "Désinscrire"
        );
    };

    const retirerInvite = (eleveId) => {
        const origine = guestOrigins[eleveId];
        const msg = origine === 'waiting' ? "Retourner en file d'attente ?" : "Retirer de la séance ?";

        triggerConfirm("Retirer l'invité ?", <p className="text-gray-600 text-sm">{msg}</p>, async () => {
            const eleve = invites.find(i => i.id === eleveId);
            setInvites(prev => prev.filter(e => e.id !== eleveId));

            const newStatuses = { ...statuses };
            delete newStatuses[eleveId];
            setStatuses(newStatuses);

            const newLinks = { ...replacementLinks };
            delete newLinks[eleveId];
            setReplacementLinks(newLinks);

            if (origine === 'waiting' && eleve && !waitingList.some(w => w.id === eleve.id)) {
                setWaitingList(prev => [...prev, eleve]);
            }
            toast.success("Invité retiré");
        }, "bg-orange-500", "Retirer");
    };

    // --- LOGIQUE FILE D'ATTENTE ---
    const ajouterAuWaitingList = () => {
        if (!selectedWaitlistId) return;
        const eleve = allStudents.find(e => e.id === selectedWaitlistId);
        if (eleve && !waitingList.find(w => w.id === eleve.id)) {
            setWaitingList(prev => [...prev, eleve]);
            setSelectedWaitlistId("");
            toast.success("Ajouté à la file d'attente");
        }
    };

    const supprimerDuWaitingList = (id) => setWaitingList(prev => prev.filter(w => w.id !== id));

    const integrerDepuisFileAttente = (eleve) => {
        const titulaireAbsentDispo = inscrits.find(t => {
            const estAbsent = statuses[t.id] === 'absent' || statuses[t.id] === 'absent_announced';
            const aDejaRemplacant = Object.values(replacementLinks).includes(t.id);
            return estAbsent && !aDejaRemplacant;
        });

        setWaitingList(prev => prev.filter(w => w.id !== eleve.id));
        setGuestOrigins(prev => ({ ...prev, [eleve.id]: 'waiting' }));
        setInvites(prev => [...prev, eleve]);
        setStatuses(prev => ({ ...prev, [eleve.id]: 'present' }));

        if (titulaireAbsentDispo) {
            setReplacementLinks(prev => ({ ...prev, [eleve.id]: titulaireAbsentDispo.id }));
        }
        toast.success(`${eleve.prenom} intégré !`);
    };

    const forcerDepuisFileAttente = (eleve) => {
        setWaitingList(prev => prev.filter(w => w.id !== eleve.id));
        setGuestOrigins(prev => ({ ...prev, [eleve.id]: 'waiting' }));
        setInvites(prev => [...prev, eleve]);
        setStatuses(prev => ({ ...prev, [eleve.id]: 'present' }));
        toast.success(`${eleve.prenom} ajouté en surnombre`);
    };

    const sauvegarder = async () => {
        setLoading(true);
        try {
            const batch = writeBatch(db);
            const ref = doc(db, "attendance", seanceId);
            const statusToSave = { ...statuses };

            Object.keys(initialStatus).forEach(id => {
                if (statuses[id] === undefined) statusToSave[id] = deleteField();
            });

            batch.set(ref, {
                date: dateStr,
                groupeId: groupe.id,
                nomGroupe: groupe.nom,
                realDate: Timestamp.fromDate(date),
                status: statusToSave,
                waitingList: waitingList.map(e => e.id),
                replacementLinks: replacementLinks,
                guestOrigins: guestOrigins,
                updatedAt: serverTimestamp()
            }, { merge: true });

            // Mise à jour des crédits
            const allIds = new Set([...Object.keys(initialStatus), ...Object.keys(statuses)]);
            allIds.forEach(eid => {
                const studentExists = allStudents.find(s => s.id === eid);
                if (!studentExists) return;

                const oldS = initialStatus[eid];
                const newS = statuses[eid];
                const finalNew = newS || 'removed';

                if (oldS === finalNew) return;

                const isTitulaire = inscrits.some(e => e.id === eid);
                let change = 0;

                if (isTitulaire) {
                    if (finalNew === 'absent' && oldS !== 'absent') change = 1;
                    else if (finalNew === 'present' && oldS === 'absent') change = -1;
                } else {
                    if (finalNew === 'present' && oldS !== 'present') change = -1;
                    else if (finalNew !== 'present' && oldS === 'present') change = 1;
                }

                if (change !== 0) {
                    if (isExceptionnel) {
                        // MODIFICATION : Pas d'impact sur le solde si séance exceptionnelle
                        const histRef = doc(collection(db, "eleves", eid, "history"));
                        batch.set(histRef, {
                            date: serverTimestamp(),
                            delta: 0, // Delta 0 pour info seulement
                            motif: `Modif Prof (Exceptionnel) : ${groupe.nom}`,
                            seanceId: seanceId,
                            groupeNom: groupe.nom,
                            seanceDate: dateStr
                        });
                    } else {
                        // Comportement STANDARD
                        batch.update(doc(db, "eleves", eid), { absARemplacer: increment(change) });
                        const histRef = doc(collection(db, "eleves", eid, "history"));
                        batch.set(histRef, {
                            date: serverTimestamp(),
                            delta: change,
                            motif: `Modif Prof : ${groupe.nom}`,
                            seanceId: seanceId,
                            groupeNom: groupe.nom,
                            seanceDate: dateStr
                        });
                    }
                }
            });

            await batch.commit();
            toast.success("Sauvegardé !");
            onClose();
        } catch (e) { console.error(e); toast.error("Erreur sauvegarde"); }
        finally { setLoading(false); }
    };

    // --- RENDER ---
    const capacity = typeof groupe.places === 'number' ? groupe.places : 10;
    const nbTitulairesPresents = inscrits.filter(i => {
        const s = statuses[i.id];
        return s !== 'absent' && s !== 'absent_announced';
    }).length;

    const nbInvites = invites.length;
    const totalPresents = nbTitulairesPresents + nbInvites;
    const realFreeSlots = capacity - totalPresents;

    const validTitulaireIds = inscrits.map(t => t.id);
    const linkedGuestIds = Object.keys(replacementLinks).filter(guestId => {
        return validTitulaireIds.includes(replacementLinks[guestId]);
    });
    const freeGuests = invites.filter(i => !linkedGuestIds.includes(i.id));

    const slotsRender = [];
    if (!isExceptionnel) {
        inscrits.forEach(titulaire => slotsRender.push({ type: 'titulaire', student: titulaire }));
    }
    const baseOccupied = isExceptionnel ? 0 : inscrits.length;
    const slotsAvailableForGuests = Math.max(0, capacity - baseOccupied);

    for (let i = 0; i < slotsAvailableForGuests; i++) {
        if (i < freeGuests.length) slotsRender.push({ type: 'guest_in_slot', student: freeGuests[i] });
        else slotsRender.push({ type: 'empty' });
    }
    const overflowGuests = freeGuests.slice(slotsAvailableForGuests);

    // --- MODALE SÉLECTION ÉLÈVE ---
    const RenderSelector = () => {
        const waitingIds = waitingList.map(w => w.id);
        const availableStudents = allStudents.filter(s =>
            !inscrits.find(i => i.id === s.id) &&
            !invites.find(i => i.id === s.id)
        );
        const priorityList = availableStudents.filter(s => waitingIds.includes(s.id));
        const standardList = availableStudents.filter(s => !waitingIds.includes(s.id));

        return (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-[1px]" onClick={() => setAddMode(null)}>
                <div className="bg-white p-6 rounded-xl shadow-2xl border-2 border-teal-500 w-96" onClick={e => e.stopPropagation()}>
                    <h4 className="text-lg font-bold text-teal-800 mb-4 uppercase flex justify-between items-center border-b pb-2">
                        {addMode === 'permanent' ? "Inscrire à l'année" : "Ajouter un participant"}
                        <button onClick={() => setAddMode(null)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
                    </h4>
                    <select autoFocus className="w-full text-base border-gray-300 border p-3 rounded-lg mb-6 outline-none" value={selectedStudentId} onChange={e => setSelectedStudentId(e.target.value)}>
                        <option value="">-- Sélectionner --</option>
                        {priorityList.length > 0 && (
                            <optgroup label="🕒 Sur File d'Attente">
                                {priorityList.map(s => <option key={s.id} value={s.id}>🕒 {s.nom} {s.prenom} ({s.absARemplacer} Cr.)</option>)}
                            </optgroup>
                        )}
                        <optgroup label="👥 Autres élèves">
                            {standardList.map(s => <option key={s.id} value={s.id}>{s.nom} {s.prenom} ({s.absARemplacer} Cr.)</option>)}
                        </optgroup>
                    </select>
                    <div className="flex gap-3 justify-end">
                        <button onClick={() => setAddMode(null)} className="px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100 font-bold">Annuler</button>
                        <button onClick={validerAjout} disabled={!selectedStudentId} className="px-6 py-2 bg-teal-600 text-white rounded-lg font-bold hover:bg-teal-700">Valider</button>
                    </div>
                </div>
            </div>
        );
    };

    if (loading) return <div className="fixed inset-0 bg-black/80 flex items-center justify-center text-white z-50">Chargement...</div>;

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            {addMode && <RenderSelector />}
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

            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl overflow-hidden flex flex-col max-h-[95vh] relative">
                {/* HEADER */}
                <div className={`p-6 text-white flex justify-between items-start ${estAnnule ? 'bg-gray-600' : (isExceptionnel ? 'bg-purple-700' : 'bg-teal-900')}`}>
                    <div className="flex-1">
                        <div className="flex items-center gap-2">
                            <h2 className="text-2xl font-bold font-playfair">{groupe.nom} {estAnnule && "(ANNULÉ)"}</h2>
                            {isExceptionnel && <span className="text-[10px] bg-white/20 px-2 py-0.5 rounded uppercase font-bold tracking-wider">Séance Unique</span>}
                        </div>
                        <div className="mt-1">
                            <p className="text-teal-100 text-sm capitalize">{date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} • {groupe.heureDebut}</p>
                            {groupe.theme && <p className="text-sm italic text-yellow-200 mt-1 border-l-2 border-yellow-200 pl-2">Thème : "{groupe.theme}"</p>}
                        </div>
                        <div className="flex gap-2 mt-4 flex-wrap">
                            {onEdit && <button onClick={() => onEdit(groupe)} className="bg-white text-purple-800 px-3 py-1.5 rounded-lg text-xs font-bold shadow-md hover:bg-gray-100 transition flex items-center gap-2">✏️ Modifier</button>}
                            {!isExceptionnel && !estAnnule && <button onClick={handleAnnulerUnique} className="bg-red-500/80 hover:bg-red-500 text-white px-3 py-1.5 rounded-lg text-xs font-bold shadow-md transition flex items-center gap-2 border border-red-400">🚫 Annuler cette séance</button>}
                            {!isExceptionnel && estAnnule && <button onClick={handleRetablir} className="bg-green-600 hover:bg-green-500 text-white px-3 py-1.5 rounded-lg text-xs font-bold shadow-md transition flex items-center gap-2">✅ Rétablir la séance</button>}
                        </div>
                    </div>
                    <button onClick={onClose} className="bg-white/20 hover:bg-white/40 rounded-full w-10 h-10 flex items-center justify-center font-bold">✕</button>
                </div>

                {/* CONTENU */}
                <div className="flex-1 overflow-y-auto p-6 bg-gray-100 relative">
                    {estAnnule && (
                        <div className="absolute inset-0 bg-white/60 z-10 flex items-center justify-center backdrop-blur-sm">
                            <div className="bg-white p-6 rounded-xl shadow-2xl text-center border-2 border-red-100">
                                <h3 className="text-xl font-bold text-gray-800 mb-2">Séance Annulée</h3>
                                <button onClick={handleRetablir} className="bg-teal-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-teal-700">Rétablir</button>
                            </div>
                        </div>
                    )}

                    {!estAnnule && (
                        <div className="flex justify-between items-center mb-6 px-2">
                            <span className="text-xs font-bold uppercase text-gray-500 tracking-wider">Remplissage</span>
                            <span className={`text-sm font-bold px-4 py-1.5 rounded-full shadow-sm border ${totalPresents > capacity ? 'bg-red-100 text-red-700 border-red-200' : 'bg-white text-teal-800 border-teal-100'}`}>
                                {totalPresents} / {capacity} places
                            </span>
                        </div>
                    )}

                    {/* GRILLE */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                        {slotsRender.map((slot, index) => {
                            if (slot.type === 'titulaire') {
                                const eleve = slot.student;
                                const status = statuses[eleve.id];
                                const isPresent = status === 'present' || status === undefined;
                                const replacementId = Object.keys(replacementLinks).find(k => replacementLinks[k] === eleve.id);
                                const replacement = replacementId ? invites.find(i => i.id === replacementId) : null;

                                return (
                                    <div key={eleve.id} className={`relative p-4 rounded-xl border-l-4 shadow-sm bg-white transition-all ${isPresent ? 'border-teal-500' : 'border-red-300 bg-red-50/20'}`}>
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <div className="font-bold text-gray-800 text-lg">{eleve.prenom} {eleve.nom}</div>
                                                <div className="text-[10px] uppercase font-bold text-gray-400 mb-2 tracking-wide">Titulaire</div>
                                            </div>
                                            {/* BOUTONS ADMIN */}
                                            <div className="flex items-center gap-2">
                                                <button onClick={() => toggleStatus(eleve.id)} className={`text-xs px-3 py-1 rounded font-bold border transition ${isPresent ? 'bg-teal-50 text-teal-700 border-teal-200' : 'bg-white text-red-500 border-red-200 shadow-sm'}`}>
                                                    {isPresent ? 'Présent' : 'Absent'}
                                                </button>
                                                {!isPresent && !replacement && (
                                                    <button onClick={() => preparerAjout('replace', eleve.id)} className="w-8 h-8 rounded-full bg-purple-100 text-purple-600 hover:bg-purple-200 flex items-center justify-center font-bold border border-purple-200" title="Remplacer">+</button>
                                                )}
                                                <button onClick={() => desinscrireTitulaire(eleve)} className="text-gray-300 hover:text-red-500 p-1.5 rounded-full hover:bg-red-50" title="Désinscrire">🗑️</button>
                                            </div>
                                        </div>
                                        {replacement && (
                                            <div className="mt-3 pt-3 border-t border-purple-100 flex justify-between items-center text-purple-700">
                                                <div className="flex items-center gap-2"><span className="text-xl">↳</span><span className="font-bold text-sm block">{replacement.prenom} {replacement.nom}</span><span className="text-[9px] bg-purple-100 px-1.5 py-0.5 rounded uppercase font-bold">Remplaçant</span></div>
                                                <button onClick={() => retirerInvite(replacement.id)} className="text-gray-400 hover:text-red-500 w-6 h-6 flex items-center justify-center">✕</button>
                                            </div>
                                        )}
                                    </div>
                                );
                            }
                            if (slot.type === 'guest_in_slot') {
                                const eleve = slot.student;
                                return (
                                    <div key={eleve.id} className="p-4 rounded-xl border-l-4 border-purple-500 bg-purple-50 shadow-sm flex justify-between items-center">
                                        <div><div className="font-bold text-gray-800 text-lg">{eleve.prenom} {eleve.nom}</div><div className="text-[10px] uppercase font-bold text-purple-600 tracking-wide">{isExceptionnel ? "Participant" : "Invité (Ponctuel)"}</div></div>
                                        <button onClick={() => retirerInvite(eleve.id)} className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-red-500 rounded-full hover:bg-white transition">✕</button>
                                    </div>
                                );
                            }
                            return (
                                <div key={`empty-${index}`} className="relative p-4 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 flex flex-col justify-center items-center min-h-[110px] group hover:border-teal-400 hover:bg-white transition-all">
                                    <div className="text-gray-400 text-xs font-bold uppercase mb-3 tracking-widest group-hover:text-teal-600">Place Libre</div>
                                    <div className="flex gap-3 relative">
                                        {!isExceptionnel && <button onClick={() => preparerAjout('permanent')} className="px-4 py-1.5 bg-white border border-gray-300 rounded-lg text-xs font-bold text-gray-600 hover:text-teal-700 hover:border-teal-500 shadow-sm transition">👤 Titulaire</button>}
                                        <button onClick={() => preparerAjout('guest')} className={`px-4 py-1.5 bg-white border border-gray-300 rounded-lg text-xs font-bold text-gray-600 hover:text-purple-700 hover:border-purple-500 shadow-sm transition ${isExceptionnel ? 'w-full' : ''}`}>{isExceptionnel ? "➕ Ajouter un participant" : "🎟️ Invité"}</button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* SURNOMBRE */}
                    {overflowGuests.length > 0 && (
                        <div className="mt-8 border-t pt-6 border-gray-200">
                            <h3 className="text-xs font-bold text-red-600 uppercase mb-3 flex items-center gap-2">⚠️ Surnombre (Hors Capacité)</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {overflowGuests.map(eleve => (
                                    <div key={eleve.id} className="p-3 rounded-lg border border-red-200 bg-red-50 flex justify-between items-center shadow-sm">
                                        <div className="flex items-center gap-3"><span className="text-red-500 font-bold text-xl">+</span><span className="text-sm font-bold text-gray-800">{eleve.prenom} {eleve.nom}</span></div>
                                        <button onClick={() => retirerInvite(eleve.id)} className="text-red-400 hover:text-red-700 font-bold px-2 py-1 hover:bg-red-100 rounded transition">✕</button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* FILE D'ATTENTE */}
                    <div className="mt-8 bg-orange-50 rounded-xl border border-orange-200 p-5 shadow-sm">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xs font-bold text-orange-800 uppercase flex items-center gap-2 tracking-wide">🕒 Liste d'attente ({waitingList.length || 0})</h3>
                            <div className="flex gap-2">
                                <select className="text-xs border-orange-200 rounded-lg bg-white py-2 pl-2 pr-8 outline-none" value={selectedWaitlistId} onChange={e => setSelectedWaitlistId(e.target.value)}>
                                    <option value="">+ Ajouter</option>
                                    {allStudents.filter(s => !inscrits.find(i => i.id === s.id) && !invites.find(i => i.id === s.id) && !waitingList.find(w => w.id === s.id)).map(s => <option key={s.id} value={s.id}>{s.nom} {s.prenom}</option>)}
                                </select>
                                <button onClick={ajouterAuWaitingList} disabled={!selectedWaitlistId} className="bg-orange-400 text-white px-3 rounded-lg font-bold text-lg hover:bg-orange-500 shadow-sm">+</button>
                            </div>
                        </div>
                        <div className="space-y-2">
                            {waitingList.map(eleve => (
                                <div key={eleve.id} className="bg-white p-3 rounded-lg border border-orange-100 flex justify-between items-center shadow-sm">
                                    <span className="text-sm font-medium text-gray-800">{eleve.prenom} {eleve.nom}</span>
                                    <div className="flex gap-2">
                                        {realFreeSlots > 0 && <button onClick={() => integrerDepuisFileAttente(eleve)} className="text-[10px] bg-green-100 text-green-800 px-3 py-1.5 rounded font-bold hover:bg-green-200 border border-green-200 transition">📥 REMPLACER</button>}
                                        <button onClick={() => forcerDepuisFileAttente(eleve)} className="text-[10px] bg-teal-50 text-teal-800 px-3 py-1.5 rounded font-bold hover:bg-teal-100 border border-teal-200 transition">SURNOMBRE</button>
                                        <button onClick={() => supprimerDuWaitingList(eleve.id)} className="text-gray-400 hover:text-red-500 w-8 flex items-center justify-center hover:bg-red-50 rounded">✕</button>
                                    </div>
                                </div>
                            ))}
                            {waitingList.length === 0 && <p className="text-xs text-orange-300 italic text-center py-2">La file d'attente est vide.</p>}
                        </div>
                    </div>
                </div>

                <div className="p-5 bg-white border-t flex justify-between items-center gap-4 z-40">
                    <button onClick={handleSupprimerDefinitif} className="text-gray-300 hover:text-red-600 p-2 text-sm font-bold transition flex items-center gap-1">🗑️ Supprimer tout</button>
                    <div className="flex gap-4">
                        <button onClick={onClose} className="px-5 py-2.5 text-gray-500 font-bold hover:bg-gray-100 rounded-lg transition">Fermer</button>
                        {!estAnnule && <button onClick={sauvegarder} className="bg-teal-700 text-white px-8 py-2.5 rounded-lg font-bold hover:bg-teal-800 shadow-lg transform active:scale-95 transition">Enregistrer</button>}
                    </div>
                </div>
            </div>
        </div>
    );
}