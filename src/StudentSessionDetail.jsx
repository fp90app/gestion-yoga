import { useState, useEffect } from 'react';
import { db } from './firebase';
import { doc, getDoc, writeBatch, increment, serverTimestamp, arrayUnion, arrayRemove, Timestamp, deleteField } from 'firebase/firestore';

export default function StudentSessionDetail({ session, student, onClose, onUpdate }) {
    const [attendanceData, setAttendanceData] = useState({ status: {}, replacementLinks: {}, waitingList: [] });
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);

    // Données statiques
    const { groupe, dateObj, seanceId, dateStr, isExceptionnel } = session;
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
        } finally {
            setLoading(false);
        }
    };

    // --- LOGIQUE D'ÉTAT ---
    const myId = student.id;
    const myStatus = attendanceData.status?.[myId];

    // Suis-je titulaire de CE groupe ? (Seulement si NON exceptionnel)
    const isTitulaire = !isExceptionnel && student.enrolledGroupIds && student.enrolledGroupIds.includes(groupe.id);
    const isInWaitingList = attendanceData.waitingList?.includes(myId);

    // 1. LES TITULAIRES (Seulement pour Standard)
    const inscrits = !isExceptionnel
        ? allEleves.filter(e => e.enrolledGroupIds && e.enrolledGroupIds.includes(groupe.id))
        : [];

    // 2. LES INVITÉS
    const guestIds = Object.keys(attendanceData.status || {}).filter(uid => {
        const s = attendanceData.status[uid];
        const isTit = inscrits.some(t => t.id === uid);
        return s === 'present' && !isTit;
    });
    const invites = guestIds.map(uid => allEleves.find(e => e.id === uid)).filter(Boolean);

    // --- CALCUL DES PLACES ---
    const titulairesAbsents = inscrits.filter(t =>
        attendanceData.status?.[t.id] === 'absent' ||
        attendanceData.status?.[t.id] === 'absent_announced'
    );

    const occupiedByTitulaires = inscrits.length - titulairesAbsents.length;
    const totalPresents = occupiedByTitulaires + invites.length;

    const hasWaitingList = attendanceData.waitingList && attendanceData.waitingList.length > 0;

    const placesRestantes = hasWaitingList ? 0 : (groupe.places - totalPresents);
    const isFull = placesRestantes <= 0;

    // --- AFFICHAGE GRID ---
    const mainList = isExceptionnel ? invites : inscrits;
    const slotsOccupiedCount = mainList.length;

    // CORRECTION VISUELLE ICI : 
    // On force le nombre de slots vides à 0 si c'est complet ou s'il y a de l'attente
    const emptySlotsCount = (isFull || hasWaitingList) ? 0 : Math.max(0, groupe.places - slotsOccupiedCount);

    let secondaryList = [];
    if (isExceptionnel) {
        secondaryList = invites.slice(groupe.places);
    } else {
        // CORRECTION ICI : On récupère les Clés (Guest IDs) et non les Valeurs (Titulaire IDs)
        // replacementLinks est sous la forme { GUEST_ID : TITULAIRE_ID }
        const guestWhoAreReplacements = Object.keys(attendanceData.replacementLinks || {});

        // On filtre : on garde ceux qui ne sont PAS dans la liste des clés de remplacement
        secondaryList = invites.filter(i => !guestWhoAreReplacements.includes(i.id));
    }

    // --- ACTIONS CRÉDITS ---
    const confirmCreditAction = (actionType) => {
        const solde = student.absARemplacer || 0;
        let cout = 0;
        let gain = 0;
        let message = "";

        if (actionType === 'book') {
            cout = 1;
            message = `RÉSERVATION\n\nSolde actuel : ${solde}\nCoût : ${cout}\n----------------\nNouveau solde : ${solde - cout}\n\nConfirmer la réservation ?`;
        } else if (actionType === 'cancel_booking') {
            gain = 1;
            message = `ANNULATION\n\nSolde actuel : ${solde}\nRemboursement : +${gain}\n----------------\nNouveau solde : ${solde + gain}\n\nConfirmer l'annulation ?`;
        } else if (actionType === 'signal_absence') {
            gain = 1;
            message = `SIGNALER ABSENCE\n\nSolde actuel : ${solde}\nCrédit récupéré : +${gain}\n----------------\nNouveau solde : ${solde + gain}\n\nLibérer votre place ?`;
        } else if (actionType === 'cancel_absence') {
            cout = 1;
            message = `ANNULER ABSENCE\n\nSolde actuel : ${solde}\nCoût : ${cout}\n----------------\nNouveau solde : ${solde - cout}\n\nReprendre votre place ?`;
        }

        return confirm(message);
    };

    // --- ACTIONS DB ---
    const toggleMyPresence = async () => {
        const isAbsentNow = myStatus === 'absent' || myStatus === 'absent_announced';
        if (isAbsentNow && isFull) {
            alert("❌ Impossible de reprendre votre place : le cours est complet.");
            return;
        }
        if (!confirmCreditAction(isAbsentNow ? 'cancel_absence' : 'signal_absence')) return;

        setProcessing(true);
        const batch = writeBatch(db);
        const ref = doc(db, "attendance", seanceId);
        const userRef = doc(db, "eleves", myId);

        if (isAbsentNow) {
            batch.set(ref, { status: { [myId]: deleteField() } }, { merge: true });
            batch.update(userRef, { absARemplacer: increment(-1) });
        } else {
            batch.set(ref, {
                date: dateStr,
                groupeId: groupe.id,
                nomGroupe: groupe.nom,
                realDate: Timestamp.fromDate(dateObj),
                status: { [myId]: 'absent_announced' },
                updatedAt: serverTimestamp()
            }, { merge: true });
            batch.update(userRef, { absARemplacer: increment(1) });
        }

        await batch.commit();
        await fetchLiveAttendance();
        onUpdate();
        setProcessing(false);
    };

    const bookSpot = async (targetId = null) => {
        if (!confirmCreditAction('book')) return;

        setProcessing(true);
        const batch = writeBatch(db);
        const ref = doc(db, "attendance", seanceId);
        const userRef = doc(db, "eleves", myId);

        const updateData = {
            date: dateStr,
            groupeId: groupe.id,
            nomGroupe: groupe.nom,
            realDate: Timestamp.fromDate(dateObj),
            status: { [myId]: 'present' },
            updatedAt: serverTimestamp()
        };

        if (targetId) {
            updateData.replacementLinks = { [myId]: targetId };
        }

        if (isInWaitingList) {
            updateData.waitingList = arrayRemove(myId);
        }

        batch.set(ref, updateData, { merge: true });
        batch.update(userRef, { absARemplacer: increment(-1) });

        await batch.commit();
        await fetchLiveAttendance();
        onUpdate();
        setProcessing(false);
    };

    const cancelBooking = async () => {
        if (!confirmCreditAction('cancel_booking')) return;
        setProcessing(true);

        const batch = writeBatch(db);
        const ref = doc(db, "attendance", seanceId);
        const userRef = doc(db, "eleves", myId);

        const updates = {
            [`status.${myId}`]: deleteField(),
            [`replacementLinks.${myId}`]: deleteField()
        };

        batch.update(ref, updates);
        batch.update(userRef, { absARemplacer: increment(1) });

        await batch.commit();
        await fetchLiveAttendance();
        onUpdate();
        setProcessing(false);
    };

    const toggleWaitlist = async () => {
        setProcessing(true);
        const ref = doc(db, "attendance", seanceId);
        const batch = writeBatch(db);

        if (isInWaitingList) {
            if (confirm("Quitter la file d'attente ?")) {
                batch.update(ref, { waitingList: arrayRemove(myId) });
            } else { setProcessing(false); return; }
        } else {
            batch.set(ref, {
                date: dateStr,
                groupeId: groupe.id,
                nomGroupe: groupe.nom,
                realDate: Timestamp.fromDate(dateObj),
                waitingList: arrayUnion(myId)
            }, { merge: true });
        }
        await batch.commit();
        await fetchLiveAttendance();
        onUpdate();
        setProcessing(false);
    };

    if (loading) return <div className="p-10 text-center">Chargement...</div>;

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div className={`p-6 text-white flex justify-between items-start ${isExceptionnel ? 'bg-purple-800' : 'bg-teal-900'}`}>
                    <div>
                        <div className="flex items-center gap-2">
                            <h3 className="text-2xl font-playfair font-bold">{groupe.nom}</h3>
                            {isExceptionnel && <span className="text-[10px] bg-white/20 px-2 rounded uppercase font-bold border border-white/20">Unique</span>}
                        </div>
                        <p className="text-white/80 text-sm mt-1 capitalize">
                            {dateObj.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} • {groupe.heureDebut}
                        </p>
                        {groupe.theme && (
                            <div className="mt-3 bg-white/10 p-2.5 rounded-lg border border-white/20 text-sm italic text-yellow-50 shadow-sm">
                                <span className="mr-1">ℹ️</span> {groupe.theme}
                            </div>
                        )}
                    </div>
                    <button onClick={onClose} className="bg-white/20 hover:bg-white/40 text-white rounded-full w-10 h-10 flex items-center justify-center font-bold text-xl transition">✕</button>
                </div>

                {/* Jauge */}
                <div className="bg-gray-50 border-b p-4">
                    <div className="flex justify-between items-end mb-1">
                        <span className="text-xs font-bold text-gray-500 uppercase">Remplissage</span>
                        <span className={`text-sm font-bold ${isFull ? 'text-red-600' : 'text-teal-700'}`}>
                            {totalPresents} / {groupe.places} places
                        </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                        <div className={`h-2 rounded-full transition-all duration-500 ${isFull ? 'bg-red-500' : 'bg-teal-500'}`} style={{ width: `${Math.min((totalPresents / groupe.places) * 100, 100)}%` }}></div>
                    </div>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-4 bg-gray-100 space-y-4">

                    {/* LISTE PRINCIPALE */}
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                        <div className="bg-teal-50 px-4 py-2 border-b border-teal-100 text-xs font-bold text-teal-800 uppercase tracking-wider">
                            {isExceptionnel ? "Participants Inscrits" : "Groupe Régulier"}
                        </div>
                        <div className="divide-y divide-gray-50">
                            {/* BOUCLE LISTE PRINCIPALE */}
                            {mainList.map(eleve => {
                                const status = attendanceData.status?.[eleve.id];
                                const isAbsent = !isExceptionnel && (status === 'absent' || status === 'absent_announced');
                                const isMe = eleve.id === myId;

                                const replacementId = Object.keys(attendanceData.replacementLinks || {}).find(k => attendanceData.replacementLinks[k] === eleve.id);
                                const replacement = replacementId ? invites.find(i => i.id === replacementId) : null;

                                return (
                                    <div key={eleve.id} className="relative">
                                        <div className={`p-3 flex items-center justify-between ${isAbsent ? 'bg-gray-50/80' : ''}`}>
                                            <div className="flex items-center gap-3">
                                                <div className={`w-2.5 h-2.5 rounded-full ${isAbsent ? 'border-2 border-gray-300' : 'bg-teal-500'}`}></div>
                                                <div className={isAbsent ? 'opacity-50' : ''}>
                                                    <div className={`text-sm font-bold ${isMe ? 'text-teal-700' : 'text-gray-800'}`}>
                                                        {eleve.prenom} {eleve.nom.charAt(0)}. {isMe && "(Moi)"}
                                                    </div>
                                                    {isAbsent && <div className="text-[10px] text-gray-400">Absent</div>}
                                                </div>
                                            </div>

                                            {/* ACTIONS */}
                                            {isTitulaire && isMe && !processing && (
                                                <button
                                                    onClick={toggleMyPresence}
                                                    disabled={isAbsent && isFull}
                                                    className={`text-xs font-bold px-3 py-1.5 rounded border transition ${isAbsent
                                                        ? (isFull ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-teal-50 text-teal-700 border-teal-200')
                                                        : 'bg-white text-red-500 border-red-100'
                                                        }`}
                                                >
                                                    {isAbsent ? (isFull ? "Complet" : "Je viens") : "S'absenter"}
                                                </button>
                                            )}

                                            {isExceptionnel && isMe && !processing && (
                                                <button onClick={cancelBooking} className="text-[10px] bg-red-50 text-red-500 border border-red-100 px-2 py-1 rounded hover:bg-red-100">
                                                    Annuler
                                                </button>
                                            )}

                                            {!isExceptionnel && !isTitulaire && !isMe && isAbsent && !replacement && !myStatus && !processing && (
                                                <button onClick={() => bookSpot(eleve.id)} className="text-[10px] bg-purple-600 text-white px-3 py-1.5 rounded font-bold hover:bg-purple-700 animate-pulse shadow-sm">
                                                    Prendre cette place
                                                </button>
                                            )}
                                        </div>

                                        {isAbsent && replacement && (
                                            <div className="ml-8 mb-2 flex items-center gap-2 text-xs text-purple-700 bg-purple-50 p-1.5 rounded-r border-l-2 border-purple-300">
                                                <span>↳</span>
                                                <span className="font-bold">{replacement.prenom} {replacement.nom.charAt(0)}.</span>
                                                <span className="text-[9px] opacity-70 uppercase">Remplaçant</span>
                                                {replacement.id === myId && <span className="text-[9px] bg-purple-200 px-1 rounded ml-auto">C'est moi</span>}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}

                            {/* CASES VIDES */}
                            {Array.from({ length: emptySlotsCount }).map((_, idx) => (
                                <div key={`empty-${idx}`} className="p-3 flex items-center justify-between bg-gray-50 border-dashed border-gray-200">
                                    <div className="flex items-center gap-3 opacity-60">
                                        <div className="w-2.5 h-2.5 rounded-full border-2 border-gray-300 border-dashed"></div>
                                        <div>
                                            <div className="text-sm font-bold text-gray-400 italic">Place disponible</div>
                                        </div>
                                    </div>

                                    {!isTitulaire && !myStatus && !processing && (
                                        <button
                                            onClick={() => bookSpot(null)}
                                            className="text-[10px] bg-purple-600 text-white px-3 py-1.5 rounded font-bold hover:bg-purple-700 shadow-sm"
                                        >
                                            Réserver
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* LISTE SECONDAIRE */}
                    {secondaryList.length > 0 && (
                        <div className="bg-purple-50 rounded-xl shadow-sm border border-purple-100 overflow-hidden">
                            <div className="px-4 py-2 border-b border-purple-100 text-xs font-bold text-purple-800 uppercase tracking-wider">
                                {isExceptionnel ? "Surnombre (Hors Capacité)" : "Autres Participants"}
                            </div>
                            <div className="p-3 space-y-2">
                                {secondaryList.map(eleve => (
                                    <div key={eleve.id} className="flex justify-between items-center text-sm">
                                        <div className="flex items-center gap-2">
                                            <span>✅</span>
                                            <span className="font-medium text-gray-700">{eleve.prenom} {eleve.nom.charAt(0)}.</span>
                                            {eleve.id === myId && <span className="text-[9px] bg-purple-200 text-purple-800 px-1 rounded font-bold ml-2">(Moi)</span>}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* LISTE D'ATTENTE */}
                    {attendanceData.waitingList && attendanceData.waitingList.length > 0 && (
                        <div className="bg-orange-50 rounded-xl border border-orange-200 p-3">
                            <div className="text-xs font-bold text-orange-800 uppercase mb-2 flex justify-between">
                                <span>File d'attente</span>
                                <span>{attendanceData.waitingList.length} en attente</span>
                            </div>
                            <div className="flex flex-wrap gap-1">
                                {attendanceData.waitingList.map(uid => {
                                    const el = allEleves.find(e => e.id === uid);
                                    if (!el) return null;
                                    return (
                                        <span key={uid} className={`text-xs px-2 py-1 rounded border ${uid === myId ? 'bg-orange-200 text-orange-900 border-orange-300 font-bold' : 'bg-white text-orange-600 border-orange-100'}`}>
                                            {el.prenom} {el.nom.charAt(0)}.
                                        </span>
                                    )
                                })}
                            </div>
                        </div>
                    )}

                </div>

                {/* FOOTER */}
                <div className="p-4 bg-white border-t">
                    {isTitulaire ? (
                        <p className="text-center text-xs text-gray-400">
                            {myStatus === 'absent_announced' ? "Vous avez signalé votre absence." : "Vous êtes titulaire de ce créneau."}
                        </p>
                    ) : (
                        myStatus === 'present' ? (
                            <button onClick={cancelBooking} className="w-full py-3 bg-red-50 text-red-600 font-bold rounded-xl border border-red-200 hover:bg-red-100">
                                Annuler ma réservation (+1 crédit)
                            </button>
                        ) : isInWaitingList ? (
                            <button onClick={toggleWaitlist} className="w-full py-3 bg-white text-orange-600 font-bold rounded-xl border border-orange-200 hover:bg-orange-50">
                                Quitter la file d'attente
                            </button>
                        ) : isFull ? (
                            <button onClick={toggleWaitlist} className="w-full py-3 bg-orange-500 text-white font-bold rounded-xl hover:bg-orange-600 shadow-lg">
                                M'inscrire sur file d'attente
                            </button>
                        ) : (
                            <div className="text-center text-xs text-gray-400 italic">
                                Sélectionnez une place disponible ci-dessus pour réserver.
                            </div>
                        )
                    )}
                </div>

            </div>
        </div>
    );
}