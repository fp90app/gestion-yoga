import { useState, useEffect } from 'react';
import { db } from './firebase';
import { doc, getDoc, writeBatch, increment, serverTimestamp, arrayUnion, arrayRemove, Timestamp, deleteField, collection } from 'firebase/firestore';
import ConfirmModal from './components/ConfirmModal';
import toast from 'react-hot-toast';

export default function StudentSessionDetail({ session, student, onClose, onUpdate }) {
    const [attendanceData, setAttendanceData] = useState({ status: {}, replacementLinks: {}, waitingList: [] });
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);
    const [confirmConfig, setConfirmConfig] = useState(null);

    const { groupe, dateObj, seanceId, dateStr, isExceptionnel, isPast } = session; // <--- On récupère isPast
    const allEleves = session.donneesGlobales.allEleves;

    useEffect(() => {
        fetchLiveAttendance();
    }, []);

    const fetchLiveAttendance = async () => {
        try {
            const docSnap = await getDoc(doc(db, "attendance", seanceId));
            if (docSnap.exists()) {
                setAttendanceData(docSnap.data());
            } else {
                setAttendanceData({ status: {}, replacementLinks: {}, waitingList: [] });
            }
        } catch (e) {
            console.error(e);
            toast.error("Erreur chargement données");
        } finally {
            setLoading(false);
        }
    };

    const myId = student.id;
    const myStatus = attendanceData.status?.[myId];
    const isTitulaire = !isExceptionnel && student.enrolledGroupIds && student.enrolledGroupIds.includes(groupe.id);
    const isInWaitingList = attendanceData.waitingList?.includes(myId);

    const inscrits = !isExceptionnel
        ? allEleves.filter(e => e.enrolledGroupIds && e.enrolledGroupIds.includes(groupe.id))
        : [];

    const guestIds = Object.keys(attendanceData.status || {}).filter(uid => {
        const s = attendanceData.status[uid];
        const isTit = inscrits.some(t => t.id === uid);
        return s === 'present' && !isTit;
    });
    const invites = guestIds.map(uid => allEleves.find(e => e.id === uid)).filter(Boolean);
    const replacementLinks = attendanceData.replacementLinks || {};

    const capacity = typeof groupe.places === 'number' ? groupe.places : 10;
    const nbTitulairesPresents = inscrits.filter(t => attendanceData.status?.[t.id] === 'present').length;
    const nbInvitesTotal = invites.length;
    const totalPresents = nbTitulairesPresents + nbInvitesTotal;
    const isPhysicallyFull = totalPresents >= capacity;

    const addHistoryEntry = (batch, delta, motif) => {
        const historyRef = doc(collection(db, "eleves", myId, "history"));
        batch.set(historyRef, {
            date: serverTimestamp(),
            delta: delta,
            motif: motif,
            seanceId: seanceId,
            groupeNom: groupe.nom,
            seanceDate: dateStr
        });
    };

    // --- UI CONFIRMATION ---
    const DetailBox = ({ children, borderColor = "border-gray-200" }) => (
        <div className={`bg-gray-50 p-4 rounded-lg border ${borderColor} text-sm space-y-2`}>{children}</div>
    );
    const Row = ({ label, value, color = "text-gray-800", bold = false }) => (
        <div className={`flex justify-between ${color} ${bold ? 'font-bold' : ''}`}><span>{label}</span><span>{value}</span></div>
    );

    const triggerConfirmation = (actionType, callback) => {
        const solde = student.absARemplacer || 0;
        let config = { onConfirm: callback };

        if (actionType === 'book') {
            config.title = "Réserver ce cours ?";
            config.colorClass = "bg-teal-600";
            config.confirmLabel = "Confirmer (-1 séance)";
            config.content = (
                <DetailBox>
                    <Row label="Solde actuel :" value={solde} color="text-gray-500" />
                    <Row label="Coût :" value="-1" color="text-red-600" bold />
                    <div className="border-t pt-2 mt-2"><Row label="Nouveau solde :" value={solde - 1} bold /></div>
                </DetailBox>
            );
        } else if (actionType === 'cancel_booking') {
            config.title = "Annuler la réservation ?";
            config.colorClass = "bg-red-500";
            config.confirmLabel = "Oui, annuler";
            config.content = (
                <DetailBox>
                    <Row label="Solde actuel :" value={solde} color="text-gray-500" />
                    <Row label="Remboursement :" value="+1" color="text-green-600" bold />
                    <div className="border-t pt-2 mt-2"><Row label="Nouveau solde :" value={solde + 1} bold /></div>
                </DetailBox>
            );
        } else if (actionType === 'signal_absence') {
            config.title = "Signaler votre absence ?";
            config.colorClass = "bg-orange-500";
            config.confirmLabel = "Libérer ma place";
            config.content = (
                <DetailBox>
                    <p className="text-gray-600 mb-2 italic text-xs">Merci de prévenir !</p>
                    <Row label="Solde actuel :" value={solde} color="text-gray-500" />
                    <Row label="Récupération :" value="+1" color="text-green-600" bold />
                    <div className="border-t pt-2 mt-2"><Row label="Nouveau solde :" value={solde + 1} bold /></div>
                </DetailBox>
            );
        } else if (actionType === 'signal_absence_late') {
            config.title = "Annulation tardive (< 2h)";
            config.colorClass = "bg-red-500";
            config.confirmLabel = "Confirmer l'absence";
            config.content = (
                <DetailBox borderColor="border-red-200">
                    <p className="text-red-600 mb-2 font-bold text-xs">⚠️ Le cours commence bientôt.</p>
                    <p className="text-gray-600 mb-2 text-xs">Pas de remboursement possible.</p>
                    <Row label="Solde actuel :" value={solde} color="text-gray-500" />
                    <Row label="Récupération :" value="0" color="text-gray-400" bold />
                </DetailBox>
            );
        } else if (actionType === 'cancel_absence') {
            config.title = "Reprendre votre place ?";
            config.colorClass = "bg-teal-600";
            config.confirmLabel = "Je reviens";
            config.content = (
                <DetailBox>
                    <Row label="Solde actuel :" value={solde} color="text-gray-500" />
                    <Row label="Coût :" value="-1" color="text-red-600" bold />
                    <div className="border-t pt-2 mt-2"><Row label="Nouveau solde :" value={solde - 1} bold /></div>
                </DetailBox>
            );
        } else if (actionType === 'waitlist_join') {
            config.title = "Rejoindre la file d'attente ?";
            config.colorClass = "bg-orange-400";
            config.confirmLabel = "M'inscrire";
            config.content = <p className="text-gray-600 text-sm">Vous serez notifié(e) par email.</p>;
        } else if (actionType === 'waitlist_leave') {
            config.title = "Quitter la file d'attente ?";
            config.colorClass = "bg-gray-500";
            config.confirmLabel = "Quitter";
            config.content = <p className="text-gray-600 text-sm">Vous ne recevrez plus de notifications.</p>;
        }

        setConfirmConfig(config);
    };

    const handleAction = async (actionFunction, successMessage) => {
        setConfirmConfig(null);
        setProcessing(true);
        const toastId = toast.loading("Traitement...");
        try {
            await actionFunction();
            await fetchLiveAttendance();
            if (onUpdate) onUpdate();
            toast.success(successMessage, { id: toastId });
        } catch (error) {
            console.error(error);
            toast.error("Erreur", { id: toastId });
        } finally {
            setProcessing(false);
        }
    };

    // --- ACTIONS ---

    const toggleMyPresence = () => {
        if (isPast) return; // Sécurité double
        const isAbsentNow = myStatus === 'absent' || myStatus === 'absent_announced';
        if (isAbsentNow && isPhysicallyFull) return toast.error("Cours complet.");

        let actionType = 'signal_absence';
        let isLate = false;

        if (isAbsentNow) {
            actionType = 'cancel_absence';
        } else {
            const [h, m] = groupe.heureDebut.split(':').map(Number);
            const courseDate = new Date(dateObj);
            courseDate.setHours(h, m, 0, 0);
            if ((courseDate - new Date()) / 36e5 < 2) {
                actionType = 'signal_absence_late';
                isLate = true;
            }
        }

        triggerConfirmation(actionType, () => handleAction(async () => {
            const batch = writeBatch(db);
            const ref = doc(db, "attendance", seanceId);
            const userRef = doc(db, "eleves", myId);

            if (isAbsentNow) {
                batch.set(ref, { status: { [myId]: deleteField() } }, { merge: true });
                batch.update(userRef, { absARemplacer: increment(-1) });
                addHistoryEntry(batch, -1, `Retour : ${groupe.nom} (${dateStr})`);
            } else {
                batch.set(ref, {
                    date: dateStr, groupeId: groupe.id, nomGroupe: groupe.nom, realDate: Timestamp.fromDate(dateObj),
                    status: { [myId]: 'absent_announced' }, updatedAt: serverTimestamp()
                }, { merge: true });

                if (!isLate) {
                    batch.update(userRef, { absARemplacer: increment(1) });
                    addHistoryEntry(batch, 1, `Absence : ${groupe.nom} (${dateStr})`);
                } else {
                    addHistoryEntry(batch, 0, `Absence Tardive : ${groupe.nom} (${dateStr})`);
                }
            }
            await batch.commit();
        }, isLate ? "Noté (Tardif)." : "Absence notée (+1)."));
    };

    const bookSpot = () => {
        if (isPast) return;
        triggerConfirmation('book', () => handleAction(async () => {
            const batch = writeBatch(db);
            const ref = doc(db, "attendance", seanceId);
            const userRef = doc(db, "eleves", myId);

            let updateData = {
                date: dateStr, groupeId: groupe.id, nomGroupe: groupe.nom, realDate: Timestamp.fromDate(dateObj),
                status: { [myId]: 'present' }, updatedAt: serverTimestamp()
            };

            if (!isExceptionnel) {
                const titulaireAbsentDispo = inscrits.find(t => {
                    const status = attendanceData.status?.[t.id];
                    const estAbsent = status === 'absent' || status === 'absent_announced';
                    const estDejaRemplace = Object.values(replacementLinks).includes(t.id);
                    return estAbsent && !estDejaRemplace;
                });
                if (titulaireAbsentDispo) {
                    updateData.replacementLinks = { ...replacementLinks, [myId]: titulaireAbsentDispo.id };
                }
            }
            if (isInWaitingList) updateData.waitingList = arrayRemove(myId);

            batch.set(ref, updateData, { merge: true });
            batch.update(userRef, { absARemplacer: increment(-1) });
            addHistoryEntry(batch, -1, `Réservation : ${groupe.nom} (${dateStr})`);

            await batch.commit();
        }, "Réservé !"));
    };

    const cancelBooking = () => {
        if (isPast) return;
        triggerConfirmation('cancel_booking', () => handleAction(async () => {
            const batch = writeBatch(db);
            const ref = doc(db, "attendance", seanceId);
            const userRef = doc(db, "eleves", myId);

            batch.update(ref, {
                [`status.${myId}`]: deleteField(),
                [`replacementLinks.${myId}`]: deleteField()
            });
            batch.update(userRef, { absARemplacer: increment(1) });
            addHistoryEntry(batch, 1, `Annulation Résa : ${groupe.nom} (${dateStr})`);

            await batch.commit();
        }, "Annulé (+1)."));
    };

    const toggleWaitlist = () => {
        if (isPast) return;
        const action = isInWaitingList ? 'waitlist_leave' : 'waitlist_join';
        triggerConfirmation(action, () => handleAction(async () => {
            const batch = writeBatch(db);
            const ref = doc(db, "attendance", seanceId);
            if (isInWaitingList) batch.update(ref, { waitingList: arrayRemove(myId) });
            else batch.set(ref, {
                date: dateStr, groupeId: groupe.id, nomGroupe: groupe.nom, realDate: Timestamp.fromDate(dateObj),
                waitingList: arrayUnion(myId)
            }, { merge: true });
            await batch.commit();
        }, isInWaitingList ? "Quitté." : "Inscrit !"));
    };

    if (loading) return <div className="fixed inset-0 bg-black/80 flex items-center justify-center text-white z-50">Chargement...</div>;

    const linkedGuestIds = Object.keys(replacementLinks).filter(guestId => {
        const titulaireId = replacementLinks[guestId];
        return inscrits.some(t => t.id === titulaireId);
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

            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl overflow-hidden flex flex-col max-h-[95vh] relative" onClick={e => e.stopPropagation()}>

                {/* HEADER SPÉCIAL "PASSÉ" */}
                {isPast && (
                    <div className="bg-gray-800 text-white text-center py-2 text-xs font-bold uppercase tracking-widest">
                        Ce cours est terminé
                    </div>
                )}

                <div className={`p-6 text-white flex justify-between items-start ${isExceptionnel ? 'bg-purple-800' : 'bg-teal-900'} ${isPast ? 'opacity-90 saturate-50' : ''}`}>
                    <div>
                        <div className="flex items-center gap-2">
                            <h2 className="text-2xl font-bold font-playfair">{groupe.nom}</h2>
                            {isExceptionnel && <span className="text-[10px] bg-white/20 px-2 py-0.5 rounded uppercase font-bold tracking-wider">Séance Unique</span>}
                        </div>
                        <div className="mt-1">
                            <p className="text-white/90 text-sm capitalize">
                                {dateObj.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} • {groupe.heureDebut}
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="bg-white/20 hover:bg-white/40 rounded-full w-10 h-10 flex items-center justify-center font-bold">✕</button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 bg-gray-100">
                    <div className="flex justify-between items-center mb-6 px-2">
                        <span className="text-xs font-bold uppercase text-gray-500 tracking-wider">Remplissage</span>
                        <span className={`text-sm font-bold px-4 py-1.5 rounded-full shadow-sm border ${isPhysicallyFull ? 'bg-red-100 text-red-700 border-red-200' : 'bg-white text-teal-800 border-teal-100'}`}>
                            {totalPresents} / {capacity} places
                        </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                        {slotsRender.map((slot, index) => {
                            if (slot.type === 'titulaire') {
                                const eleve = slot.student;
                                const isMe = eleve.id === myId;
                                const status = attendanceData.status?.[eleve.id];
                                const isPresent = status === 'present' || status === undefined;
                                const isAbsent = !isPresent;
                                const replacementId = Object.keys(replacementLinks).find(k => replacementLinks[k] === eleve.id);
                                const replacement = replacementId ? invites.find(i => i.id === replacementId) : null;
                                const cannotReclaim = isMe && isAbsent && isPhysicallyFull;
                                let borderClass = isPresent ? 'border-teal-500' : 'border-red-300 bg-red-50/20';
                                if (isMe) borderClass += " ring-2 ring-teal-200";

                                return (
                                    <div key={eleve.id} className={`relative p-4 rounded-xl border-l-4 shadow-sm bg-white transition-all ${borderClass} ${isPast ? 'opacity-80' : ''}`}>
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <div className="font-bold text-gray-800 text-lg flex items-center gap-2">
                                                    {eleve.prenom} {eleve.nom.charAt(0)}.
                                                    {isMe && <span className="bg-teal-100 text-teal-800 text-[10px] px-1.5 py-0.5 rounded uppercase">Moi</span>}
                                                </div>
                                                <div className="text-[10px] uppercase font-bold text-gray-400 mb-2 tracking-wide">Titulaire</div>
                                                {isMe && !processing && !isPast && ( // <--- BLOQUÉ SI PASSÉ
                                                    <div className="group relative inline-block">
                                                        <button onClick={toggleMyPresence} disabled={cannotReclaim} className={`text-xs px-3 py-1 rounded font-bold border transition ${cannotReclaim ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed' : (isPresent ? 'bg-teal-50 text-teal-700 border-teal-200 hover:bg-teal-100' : 'bg-white text-red-500 border-red-200 shadow-sm hover:bg-red-50')}`}>
                                                            {cannotReclaim ? "Place prise" : (isPresent ? "Je m'absente" : "Je viens")}
                                                        </button>
                                                    </div>
                                                )}
                                                {!isMe && (
                                                    <div className="text-right">
                                                        <span className={`block text-xs font-bold ${isPresent ? 'text-teal-600' : 'text-red-400'}`}>{isPresent ? 'Présent' : 'Absent'}</span>
                                                        {!isPresent && !replacement && !myStatus && !processing && !isTitulaire && !isPast && ( // <--- BLOQUÉ SI PASSÉ
                                                            <button onClick={(e) => { e.stopPropagation(); bookSpot(); }} className="mt-1.5 bg-purple-600 text-white text-[10px] px-3 py-1.5 rounded-lg font-bold hover:bg-purple-700 shadow-md flex items-center gap-1"><span>⚡ Remplacer</span></button>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        {replacement && (
                                            <div className="mt-3 pt-3 border-t border-purple-100 flex justify-between items-center text-purple-700">
                                                <div className="flex items-center gap-2"><span className="text-xl">↳</span><span className="font-bold text-sm block">{replacement.prenom} {replacement.nom.charAt(0)}. {replacement.id === myId && " (Moi)"}</span></div>
                                                {replacement.id === myId && !processing && !isPast && <button onClick={(e) => { e.stopPropagation(); cancelBooking(); }} className="text-xs bg-white text-red-500 border border-red-200 px-2 py-1 rounded">Annuler</button>}
                                            </div>
                                        )}
                                    </div>
                                );
                            }
                            if (slot.type === 'guest_in_slot') {
                                const eleve = slot.student;
                                const isMe = eleve.id === myId;
                                return (
                                    <div key={eleve.id} className={`p-4 rounded-xl border-l-4 border-purple-500 bg-purple-50 shadow-sm flex justify-between items-center ${isMe ? 'ring-2 ring-purple-200' : ''} ${isPast ? 'opacity-80' : ''}`}>
                                        <div><div className="font-bold text-gray-800 text-lg">{eleve.prenom} {eleve.nom.charAt(0)}. {isMe && <span className="ml-2 bg-purple-200 text-purple-800 text-[10px] px-1.5 py-0.5 rounded uppercase">Moi</span>}</div><div className="text-[10px] uppercase font-bold text-purple-600 tracking-wide">{isExceptionnel ? "Participant" : "Invité"}</div></div>
                                        {isMe && !processing && !isPast && <button onClick={cancelBooking} className="text-xs bg-white border border-red-200 text-red-500 px-2 py-1 rounded">Annuler</button>}
                                    </div>
                                );
                            }
                            return (
                                <div key={`empty-${index}`} className={`relative p-4 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 flex flex-col justify-center items-center min-h-[100px] group transition-all ${isPast ? 'opacity-50' : 'hover:border-teal-400 hover:bg-white'}`}>
                                    <div className="text-gray-400 text-xs font-bold uppercase mb-2 tracking-widest group-hover:text-teal-600">Place Libre</div>
                                    {!isTitulaire && !myStatus && !processing && !isPast && <button onClick={bookSpot} className="px-6 py-2 bg-white border border-gray-300 rounded-lg text-sm font-bold text-gray-600 hover:text-white hover:bg-teal-600 hover:border-teal-600 shadow-sm transition">Réserver</button>}
                                </div>
                            );
                        })}
                    </div>

                    {overflowGuests.length > 0 && (
                        <div className="mt-8 border-t pt-6 border-gray-200">
                            <h3 className="text-xs font-bold text-red-600 uppercase mb-3">⚠️ Surnombre</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {overflowGuests.map(eleve => (
                                    <div key={eleve.id} className="p-3 rounded-lg border border-red-200 bg-red-50 flex justify-between items-center shadow-sm">
                                        <div className="flex items-center gap-3"><span className="text-red-500 font-bold text-xl">+</span><span className="text-sm font-bold text-gray-800">{eleve.prenom} {eleve.nom.charAt(0)}. {eleve.id === myId && "(Moi)"}</span></div>
                                        {eleve.id === myId && !isPast && <button onClick={cancelBooking} className="text-xs bg-white border border-red-200 text-red-500 px-2 py-1 rounded">Annuler</button>}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="mt-8 bg-orange-50 rounded-xl border border-orange-200 p-5 shadow-sm">
                        <div className="flex justify-between items-center mb-4"><h3 className="text-xs font-bold text-orange-800 uppercase flex items-center gap-2">🕒 Liste d'attente ({attendanceData.waitingList?.length || 0})</h3></div>
                        <div className="space-y-2">
                            {attendanceData.waitingList?.map(uid => {
                                const eleve = allEleves.find(e => e.id === uid);
                                if (!eleve) return null;
                                const isMe = uid === myId;
                                return (
                                    <div key={uid} className={`p-3 rounded-lg border flex justify-between items-center shadow-sm ${isMe ? 'bg-orange-100 border-orange-300' : 'bg-white border-orange-100'}`}>
                                        <span className={`text-sm font-medium ${isMe ? 'text-orange-900' : 'text-gray-800'}`}>{eleve.prenom} {eleve.nom.charAt(0)}. {isMe && <span className="ml-2 font-bold text-xs uppercase">(Moi)</span>}</span>
                                        {isMe && !processing && !isPast && <button onClick={toggleWaitlist} className="text-xs text-orange-600 hover:text-red-600 hover:bg-white px-2 py-1 rounded border border-transparent hover:border-gray-200 transition">Quitter</button>}
                                    </div>
                                )
                            })}
                            {(!attendanceData.waitingList || attendanceData.waitingList.length === 0) && <p className="text-xs text-orange-300 italic text-center py-2">Vide.</p>}
                        </div>
                        {!isTitulaire && !myStatus && !isInWaitingList && isPhysicallyFull && !isPast && (
                            <div className="mt-4 pt-4 border-t border-orange-200 text-center">
                                <button onClick={toggleWaitlist} className="w-full md:w-auto bg-orange-400 text-white px-6 py-2 rounded-lg font-bold hover:bg-orange-500 shadow-md transition">M'ajouter à la liste d'attente</button>
                            </div>
                        )}
                    </div>
                </div>

                <div className="p-5 bg-white border-t flex justify-end gap-4 z-40">
                    <button onClick={onClose} className="px-5 py-2.5 text-gray-500 font-bold hover:bg-gray-100 rounded-lg transition">Fermer</button>
                </div>
            </div>
        </div>
    );
}