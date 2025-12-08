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

    // --- PRÉPARATION DES DONNÉES ---
    const myId = student.id;
    const myStatus = attendanceData.status?.[myId];
    const isTitulaire = !isExceptionnel && student.enrolledGroupIds && student.enrolledGroupIds.includes(groupe.id);
    const isInWaitingList = attendanceData.waitingList?.includes(myId);

    // 1. Liste des Titulaires (Inscrits)
    const inscrits = !isExceptionnel
        ? allEleves.filter(e => e.enrolledGroupIds && e.enrolledGroupIds.includes(groupe.id))
        : [];

    // 2. Liste des Invités (Présents non titulaires)
    const guestIds = Object.keys(attendanceData.status || {}).filter(uid => {
        const s = attendanceData.status[uid];
        const isTit = inscrits.some(t => t.id === uid);
        return s === 'present' && !isTit;
    });
    const invites = guestIds.map(uid => allEleves.find(e => e.id === uid)).filter(Boolean);

    // 3. Liens de remplacement
    const replacementLinks = attendanceData.replacementLinks || {};

    // --- CALCUL DE CAPACITÉ ---
    const capacity = typeof groupe.places === 'number' ? groupe.places : 10;

    // Nombre physique : Titulaires PRÉSENTS + Tous les Invités
    const nbTitulairesPresents = inscrits.filter(t => attendanceData.status?.[t.id] === 'present').length;
    const nbInvitesTotal = invites.length;
    const totalPresents = nbTitulairesPresents + nbInvitesTotal;

    // Est-ce physiquement complet ?
    const isPhysicallyFull = totalPresents >= capacity;

    // --- ACTIONS DB ---

    const confirmCreditAction = (actionType) => {
        const solde = student.absARemplacer || 0;
        let cout = 0, gain = 0, message = "";

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

    const toggleMyPresence = async () => {
        const isAbsentNow = myStatus === 'absent' || myStatus === 'absent_announced';

        if (isAbsentNow && isPhysicallyFull) {
            alert("❌ Impossible de reprendre votre place : le cours est COMPLET (tous les tapis sont occupés).");
            return;
        }

        if (!confirmCreditAction(isAbsentNow ? 'cancel_absence' : 'signal_absence')) return;

        setProcessing(true);
        const batch = writeBatch(db);
        const ref = doc(db, "attendance", seanceId);
        const userRef = doc(db, "eleves", myId);

        if (isAbsentNow) {
            // Je reviens
            batch.set(ref, { status: { [myId]: deleteField() } }, { merge: true });
            batch.update(userRef, { absARemplacer: increment(-1) });
        } else {
            // Je m'absente
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

    const bookSpot = async () => {
        if (!confirmCreditAction('book')) return;
        setProcessing(true);

        const batch = writeBatch(db);
        const ref = doc(db, "attendance", seanceId);
        const userRef = doc(db, "eleves", myId);

        // Préparation de la mise à jour
        let updateData = {
            date: dateStr,
            groupeId: groupe.id,
            nomGroupe: groupe.nom,
            realDate: Timestamp.fromDate(dateObj),
            status: { [myId]: 'present' },
            updatedAt: serverTimestamp()
        };

        // 1. LOGIQUE AUTOMATIQUE DE REMPLACEMENT
        // On cherche un titulaire absent qui n'est PAS DÉJÀ remplacé
        if (!isExceptionnel) {
            const titulaireAbsentDispo = inscrits.find(t => {
                const status = attendanceData.status?.[t.id];
                const estAbsent = status === 'absent' || status === 'absent_announced';

                // Vérifier si son ID est déjà utilisé comme "valeur" dans replacementLinks
                const estDejaRemplace = Object.values(replacementLinks).includes(t.id);

                return estAbsent && !estDejaRemplace;
            });

            if (titulaireAbsentDispo) {
                updateData.replacementLinks = {
                    ...replacementLinks,
                    [myId]: titulaireAbsentDispo.id
                };
            }
        }

        // 2. Gestion File d'attente
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
            if (confirm("Quitter la liste d'attente ?")) {
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

    // --- CONSTRUCTION DE L'AFFICHAGE ---

    // Invités liés (Remplaçants)
    const linkedGuestIds = Object.keys(replacementLinks).filter(guestId => {
        const titulaireId = replacementLinks[guestId];
        return inscrits.some(t => t.id === titulaireId);
    });

    // Invités libres (Non liés)
    const freeGuests = invites.filter(i => !linkedGuestIds.includes(i.id));

    const slotsRender = [];

    // A. Les Titulaires
    if (!isExceptionnel) {
        inscrits.forEach(titulaire => {
            slotsRender.push({ type: 'titulaire', student: titulaire });
        });
    }

    // B. Les Invités sur places libres
    const baseOccupied = isExceptionnel ? 0 : inscrits.length;
    const slotsAvailableForGuests = Math.max(0, capacity - baseOccupied);

    for (let i = 0; i < slotsAvailableForGuests; i++) {
        if (i < freeGuests.length) {
            slotsRender.push({ type: 'guest_in_slot', student: freeGuests[i] });
        } else {
            slotsRender.push({ type: 'empty' });
        }
    }

    // C. Surnombre
    const overflowGuests = freeGuests.slice(slotsAvailableForGuests);


    if (loading) return <div className="fixed inset-0 bg-black/80 flex items-center justify-center text-white z-50">Chargement...</div>;

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl overflow-hidden flex flex-col max-h-[95vh] relative" onClick={e => e.stopPropagation()}>

                {/* HEADER */}
                <div className={`p-6 text-white flex justify-between items-start ${isExceptionnel ? 'bg-purple-800' : 'bg-teal-900'}`}>
                    <div>
                        <div className="flex items-center gap-2">
                            <h2 className="text-2xl font-bold font-playfair">{groupe.nom}</h2>
                            {isExceptionnel && <span className="text-[10px] bg-white/20 px-2 py-0.5 rounded uppercase font-bold tracking-wider">Séance Unique</span>}
                        </div>
                        <div className="mt-1">
                            <p className="text-white/90 text-sm capitalize">
                                {dateObj.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} • {groupe.heureDebut}
                            </p>
                            {groupe.theme && <p className="text-sm italic text-yellow-200 mt-1 border-l-2 border-yellow-200 pl-2">Thème : "{groupe.theme}"</p>}
                        </div>
                    </div>
                    <button onClick={onClose} className="bg-white/20 hover:bg-white/40 rounded-full w-10 h-10 flex items-center justify-center font-bold">✕</button>
                </div>

                {/* CONTENU */}
                <div className="flex-1 overflow-y-auto p-6 bg-gray-100">

                    {/* Jauge */}
                    <div className="flex justify-between items-center mb-6 px-2">
                        <span className="text-xs font-bold uppercase text-gray-500 tracking-wider">Remplissage</span>
                        <span className={`text-sm font-bold px-4 py-1.5 rounded-full shadow-sm border ${isPhysicallyFull ? 'bg-red-100 text-red-700 border-red-200' : 'bg-white text-teal-800 border-teal-100'}`}>
                            {totalPresents} / {capacity} places
                        </span>
                    </div>

                    {/* GRILLE DES PARTICIPANTS */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                        {slotsRender.map((slot, index) => {
                            // --- CAS 1 : TITULAIRE ---
                            if (slot.type === 'titulaire') {
                                const eleve = slot.student;
                                const isMe = eleve.id === myId;
                                const status = attendanceData.status?.[eleve.id];
                                const isPresent = status === 'present' || status === undefined;

                                const replacementId = Object.keys(replacementLinks).find(k => replacementLinks[k] === eleve.id);
                                const replacement = replacementId ? invites.find(i => i.id === replacementId) : null;

                                let borderClass = isPresent ? 'border-teal-500' : 'border-red-300 bg-red-50/20';
                                if (isMe) borderClass += " ring-2 ring-teal-200";

                                return (
                                    <div key={eleve.id} className={`relative p-4 rounded-xl border-l-4 shadow-sm bg-white transition-all ${borderClass}`}>
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <div className="font-bold text-gray-800 text-lg flex items-center gap-2">
                                                    {eleve.prenom} {eleve.nom.charAt(0)}.
                                                    {isMe && <span className="bg-teal-100 text-teal-800 text-[10px] px-1.5 py-0.5 rounded uppercase">Moi</span>}
                                                </div>
                                                <div className="text-[10px] uppercase font-bold text-gray-400 mb-2 tracking-wide">Titulaire</div>

                                                {/* Actions titulaire (Moi) */}
                                                {isMe && !processing && (
                                                    <button
                                                        onClick={toggleMyPresence}
                                                        className={`text-xs px-3 py-1 rounded font-bold border transition ${isPresent ? 'bg-teal-50 text-teal-700 border-teal-200 hover:bg-teal-100' : 'bg-white text-red-500 border-red-200 shadow-sm hover:bg-red-50'}`}
                                                    >
                                                        {isPresent ? "Je m'absente" : "Je viens (Reprendre place)"}
                                                    </button>
                                                )}

                                                {/* Actions Invité (Pas Moi) */}
                                                {!isMe && (
                                                    <div className="text-right">
                                                        <span className={`block text-xs font-bold ${isPresent ? 'text-teal-600' : 'text-red-400'}`}>
                                                            {isPresent ? 'Présent' : 'Absent'}
                                                        </span>
                                                        {/* BOUTON CLÉ : Prendre la place d'un absent */}
                                                        {!isPresent && !replacement && !myStatus && !processing && !isTitulaire && (
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); bookSpot(); }}
                                                                className="mt-1.5 bg-purple-600 text-white text-[10px] px-3 py-1.5 rounded-lg font-bold hover:bg-purple-700 shadow-md transition-transform active:scale-95 flex items-center gap-1"
                                                            >
                                                                <span>⚡ Remplacer</span>
                                                            </button>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {replacement && (
                                            <div className="mt-3 pt-3 border-t border-purple-100 flex justify-between items-center text-purple-700">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xl">↳</span>
                                                    <div>
                                                        <span className="font-bold text-sm block">
                                                            {replacement.prenom} {replacement.nom.charAt(0)}.
                                                            {replacement.id === myId && " (Moi)"}
                                                        </span>
                                                        <span className="text-[9px] bg-purple-100 px-1.5 py-0.5 rounded uppercase font-bold">Remplaçant</span>
                                                    </div>
                                                </div>

                                                {/* BOUTON ANNULER REMPLACEMENT (C'est Moi le remplaçant) */}
                                                {replacement.id === myId && !processing && (
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); cancelBooking(); }}
                                                        className="text-xs bg-white text-red-500 border border-red-200 px-2 py-1 rounded hover:bg-red-50 font-bold"
                                                    >
                                                        Annuler
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            }

                            // --- CAS 2 : INVITÉ SUR PLACE LIBRE ---
                            if (slot.type === 'guest_in_slot') {
                                const eleve = slot.student;
                                const isMe = eleve.id === myId;

                                return (
                                    <div key={eleve.id} className={`p-4 rounded-xl border-l-4 border-purple-500 bg-purple-50 shadow-sm flex justify-between items-center ${isMe ? 'ring-2 ring-purple-200' : ''}`}>
                                        <div>
                                            <div className="font-bold text-gray-800 text-lg">
                                                {eleve.prenom} {eleve.nom.charAt(0)}.
                                                {isMe && <span className="ml-2 bg-purple-200 text-purple-800 text-[10px] px-1.5 py-0.5 rounded uppercase">Moi</span>}
                                            </div>
                                            <div className="text-[10px] uppercase font-bold text-purple-600 tracking-wide">
                                                {isExceptionnel ? "Participant" : "Invité (Ponctuel)"}
                                            </div>
                                        </div>

                                        {isMe && !processing && (
                                            <button onClick={cancelBooking} className="text-xs bg-white border border-red-200 text-red-500 px-2 py-1 rounded hover:bg-red-50">
                                                Annuler
                                            </button>
                                        )}
                                    </div>
                                );
                            }

                            // --- CAS 3 : PLACE VIDE ---
                            return (
                                <div key={`empty-${index}`} className="relative p-4 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 flex flex-col justify-center items-center min-h-[100px] group hover:border-teal-400 hover:bg-white transition-all">
                                    <div className="text-gray-400 text-xs font-bold uppercase mb-2 tracking-widest group-hover:text-teal-600">Place Libre</div>

                                    {!isTitulaire && !myStatus && !processing && (
                                        <button
                                            onClick={bookSpot}
                                            className="px-6 py-2 bg-white border border-gray-300 rounded-lg text-sm font-bold text-gray-600 hover:text-white hover:bg-teal-600 hover:border-teal-600 shadow-sm transition"
                                        >
                                            Réserver
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {/* SURNOMBRE */}
                    {overflowGuests.length > 0 && (
                        <div className="mt-8 border-t pt-6 border-gray-200">
                            <h3 className="text-xs font-bold text-red-600 uppercase mb-3 flex items-center gap-2">
                                ⚠️ Surnombre (Hors Capacité)
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {overflowGuests.map(eleve => (
                                    <div key={eleve.id} className="p-3 rounded-lg border border-red-200 bg-red-50 flex justify-between items-center shadow-sm">
                                        <div className="flex items-center gap-3">
                                            <span className="text-red-500 font-bold text-xl">+</span>
                                            <span className="text-sm font-bold text-gray-800">
                                                {eleve.prenom} {eleve.nom.charAt(0)}.
                                                {eleve.id === myId && " (Moi)"}
                                            </span>
                                        </div>
                                        {eleve.id === myId && (
                                            <button onClick={cancelBooking} className="text-xs bg-white border border-red-200 text-red-500 px-2 py-1 rounded">
                                                Annuler
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* FILE D'ATTENTE */}
                    <div className="mt-8 bg-orange-50 rounded-xl border border-orange-200 p-5 shadow-sm">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xs font-bold text-orange-800 uppercase flex items-center gap-2 tracking-wide">
                                🕒 Liste d'attente ({attendanceData.waitingList?.length || 0})
                            </h3>
                        </div>

                        <div className="space-y-2">
                            {attendanceData.waitingList?.map(uid => {
                                const eleve = allEleves.find(e => e.id === uid);
                                if (!eleve) return null;
                                const isMe = uid === myId;
                                return (
                                    <div key={uid} className={`p-3 rounded-lg border flex justify-between items-center shadow-sm ${isMe ? 'bg-orange-100 border-orange-300' : 'bg-white border-orange-100'}`}>
                                        <span className={`text-sm font-medium ${isMe ? 'text-orange-900' : 'text-gray-800'}`}>
                                            {eleve.prenom} {eleve.nom.charAt(0)}.
                                            {isMe && <span className="ml-2 font-bold text-xs uppercase">(Moi)</span>}
                                        </span>

                                        {isMe && !processing && (
                                            <button onClick={toggleWaitlist} className="text-xs text-orange-600 hover:text-red-600 hover:bg-white px-2 py-1 rounded border border-transparent hover:border-gray-200 transition">
                                                Quitter la liste d'attente
                                            </button>
                                        )}
                                    </div>
                                )
                            })}
                            {(!attendanceData.waitingList || attendanceData.waitingList.length === 0) && (
                                <p className="text-xs text-orange-300 italic text-center py-2">La liste d'attente est vide.</p>
                            )}
                        </div>

                        {/* BOUTON REJOINDRE FILE */}
                        {!isTitulaire && !myStatus && !isInWaitingList && isPhysicallyFull && (
                            <div className="mt-4 pt-4 border-t border-orange-200 text-center">
                                <button onClick={toggleWaitlist} className="w-full md:w-auto bg-orange-400 text-white px-6 py-2 rounded-lg font-bold hover:bg-orange-500 shadow-md transition">
                                    M'ajouter à la liste d'attente
                                </button>
                            </div>
                        )}
                    </div>

                </div>

                {/* FOOTER */}
                <div className="p-5 bg-white border-t flex justify-end gap-4 z-40">
                    <button onClick={onClose} className="px-5 py-2.5 text-gray-500 font-bold hover:bg-gray-100 rounded-lg transition">Fermer</button>
                </div>

            </div>
        </div>
    );
}