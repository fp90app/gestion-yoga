import { useState, useEffect } from 'react';
import { db } from './firebase';
import { Link } from 'react-router-dom';
import { collection, query, where, getDocs, doc, getDoc, writeBatch, increment, serverTimestamp, Timestamp, arrayUnion, deleteField, setDoc } from 'firebase/firestore';
import StudentSessionDetail from './StudentSessionDetail';


const JOURS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];

// --- CONFIGURATION GRILLE ---
const HEURE_DEBUT = 8;
const HEURE_FIN = 21;
const PIXELS_PAR_HEURE = 80;

// --- HELPERS ---
const getLundi = (d) => {
    const date = new Date(d);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    date.setDate(diff);
    date.setHours(0, 0, 0, 0);
    return date;
};

const ajouterJours = (date, jours) => {
    const result = new Date(date);
    result.setDate(result.getDate() + jours);
    result.setHours(0, 0, 0, 0);
    return result;
};

const calculerHeureFin = (heureDebut, dureeMinutes) => {
    const [h, m] = heureDebut.split(':').map(Number);
    const date = new Date();
    date.setHours(h, m, 0, 0);
    date.setMinutes(date.getMinutes() + dureeMinutes);
    return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', 'h');
};

const getPlacesLabel = (count) => {
    if (count <= 0) return "Complet";
    if (count === 1) return "1 place";
    return `${count} places`;
};

export default function StudentPortal() {
    const [email, setEmail] = useState('');
    const [student, setStudent] = useState(null);
    const [loading, setLoading] = useState(false);

    const [lundiActuel, setLundiActuel] = useState(getLundi(new Date()));
    const [sessionsSemaine, setSessionsSemaine] = useState([]);
    const [donneesGlobales, setDonneesGlobales] = useState(null);

    // --- NOUVEAU : State pour la modale de détail ---
    const [selectedSession, setSelectedSession] = useState(null);

    // --- LOGIN ---
    const handleLogin = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            const emailClean = email.trim().toLowerCase();
            const q = query(collection(db, "eleves"), where("email", "==", emailClean));
            const snap = await getDocs(q);

            if (snap.empty) { alert("Email inconnu."); setLoading(false); return; }

            const studentData = { id: snap.docs[0].id, ...snap.docs[0].data() };
            setStudent(studentData);

            const [groupsSnap, elevesSnap] = await Promise.all([
                getDocs(query(collection(db, "groupes"), where("actif", "==", true))),
                getDocs(collection(db, "eleves"))
            ]);

            setDonneesGlobales({
                allGroups: groupsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
                allEleves: elevesSnap.docs.map(d => ({ id: d.id, ...d.data() }))
            });

        } catch (err) { console.error(err); } finally { setLoading(false); }
    };

    // --- POSITIONNEMENT ---
    const getCardStyle = (heureDebut, duree) => {
        const [h, m] = heureDebut.split(':').map(Number);
        const minutesDepuisDebut = (h - HEURE_DEBUT) * 60 + m;
        const top = (minutesDepuisDebut / 60) * PIXELS_PAR_HEURE;
        const height = (duree / 60) * PIXELS_PAR_HEURE;
        return { top: `${top}px`, height: `${height}px` };
    };

    // --- CHARGEMENT ---
    useEffect(() => {
        if (student && donneesGlobales) {
            calculerPlanningSemaine();
        }
    }, [student, lundiActuel, donneesGlobales]);

    const calculerPlanningSemaine = async () => {
        setLoading(true);
        const { allGroups, allEleves } = donneesGlobales;
        const debutSemaineStr = lundiActuel.toLocaleDateString('fr-CA');
        const finSemaine = ajouterJours(lundiActuel, 6);
        const finSemaineStr = finSemaine.toLocaleDateString('fr-CA');

        const [attendanceSnap, exceptionsSnap] = await Promise.all([
            getDocs(query(collection(db, "attendance"), where("date", ">=", debutSemaineStr), where("date", "<=", finSemaineStr))),
            getDocs(collection(db, "exceptions"))
        ]);

        const attendances = attendanceSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const exceptions = exceptionsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        let planning = [];

        for (let i = 0; i < 7; i++) {
            const dateDuJour = ajouterJours(lundiActuel, i);
            const jourIndexJS = dateDuJour.getDay();
            const dateStr = dateDuJour.toLocaleDateString('fr-CA');

            const groupesDuJour = allGroups.filter(g => {
                if (g.jour !== jourIndexJS) return false;
                const debut = g.dateDebut?.toDate ? g.dateDebut.toDate() : new Date('2000-01-01');
                const fin = g.dateFin?.toDate ? g.dateFin.toDate() : new Date('2099-12-31');
                debut.setHours(0, 0, 0, 0); fin.setHours(23, 59, 59, 999);
                return dateDuJour >= debut && dateDuJour <= fin;
            });

            groupesDuJour.forEach(groupe => {
                const estAnnule = exceptions.some(ex => ex.groupeId === groupe.id && ex.date === dateStr && ex.type === "annulation");
                if (estAnnule) return;

                const seanceId = `${dateStr}_${groupe.id}`;
                const attendanceDoc = attendances.find(a => a.id === seanceId);
                const statusMap = attendanceDoc?.status || {};
                const waitingListIds = attendanceDoc?.waitingList || [];

                // --- 1. LISTE DES PRÉSENTS (Pour l'affichage affinité) ---
                const recurrentsIds = allEleves
                    .filter(e => e.enrolledGroupIds && e.enrolledGroupIds.includes(groupe.id))
                    .map(e => e.id);

                const participantsSet = new Set(recurrentsIds);
                Object.entries(statusMap).forEach(([uid, st]) => {
                    if (st === 'absent' || st === 'absent_announced') participantsSet.delete(uid);
                    else if (st === 'present') participantsSet.add(uid);
                });

                // Récupération des objets élèves complets pour l'affichage
                const participantsDetails = Array.from(participantsSet)
                    .map(uid => allEleves.find(e => e.id === uid))
                    .filter(Boolean)
                    .sort((a, b) => a.prenom.localeCompare(b.prenom));

                const occupiedCount = participantsDetails.length;
                const placesRestantes = groupe.places - occupiedCount;

                // --- 2. LISTE D'ATTENTE (Nouveau) ---
                const waitingListDetails = waitingListIds
                    .map(uid => allEleves.find(e => e.id === uid))
                    .filter(Boolean);

                const myStatus = statusMap[student.id];
                const estInscritRecurrent = student.enrolledGroupIds && student.enrolledGroupIds.includes(groupe.id);
                const isMeAbsent = estInscritRecurrent && (myStatus === 'absent' || myStatus === 'absent_announced');
                const isMeGuest = !estInscritRecurrent && myStatus === 'present';
                const isInWaitingList = waitingListIds.includes(student.id);

                planning.push({
                    type: 'standard',
                    groupe,
                    dateObj: dateDuJour,
                    dateStr,
                    seanceId,
                    placesRestantes,
                    occupiedCount,
                    estInscritRecurrent,
                    isMeAbsent,
                    isMeGuest,
                    isInWaitingList,
                    participantsDetails, // Liste complète des objets élèves présents
                    waitingListDetails,
                    donneesGlobales: donneesGlobales   // Liste complète des objets élèves en attente
                });
            });
        }

        setSessionsSemaine(planning);
        setLoading(false);
    };

    // --- ACTIONS ---
    const refreshData = () => {
        // On ferme la modale et on recharge
        setSelectedSession(null);
        getDoc(doc(db, "eleves", student.id)).then(snap => {
            setStudent({ id: snap.id, ...snap.data() });
            calculerPlanningSemaine();
        });
    };

    // Au clic sur la carte, on ouvre juste la modale
    const openSessionDetails = (session) => {
        setSelectedSession(session);
    };

    const handleBooking = async () => {
        if (!selectedSession) return;
        const session = selectedSession;

        const soldeActuel = student.absARemplacer || 0;
        let messageConfirmation = "";

        if (soldeActuel <= 0) {
            messageConfirmation = `⚠️ Vous n'avez plus de crédits.\nVotre solde passera à ${soldeActuel - 1}.\n\nConfirmer l'inscription ?`;
        } else {
            messageConfirmation = `Réserver ${session.groupe.nom} ? (1 crédit sera utilisé)`;
        }

        if (!confirm(messageConfirmation)) return;

        try {
            const batch = writeBatch(db);
            const batchRef = doc(db, "attendance", session.seanceId);
            const studentRef = doc(db, "eleves", student.id);

            batch.set(batchRef, {
                date: session.dateStr,
                groupeId: session.groupe.id,
                nomGroupe: session.groupe.nom,
                realDate: Timestamp.fromDate(session.dateObj),
                status: { [student.id]: 'present' },
                updatedAt: serverTimestamp()
            }, { merge: true });

            batch.update(studentRef, { absARemplacer: increment(-1) });
            await batch.commit();
            refreshData();
        } catch (e) { console.error(e); alert("Erreur"); }
    };

    const handleCancel = async () => {
        if (!selectedSession) return;
        const session = selectedSession;

        let msg = session.estInscritRecurrent
            ? "Signaler votre absence (+1 crédit) ?"
            : "Annuler votre réservation (Crédit remboursé) ?";

        if (!confirm(msg)) return;
        try {
            const batch = writeBatch(db);
            const ref = doc(db, "attendance", session.seanceId);
            const studentRef = doc(db, "eleves", student.id);

            if (session.estInscritRecurrent) {
                batch.set(ref, {
                    date: session.dateStr,
                    groupeId: session.groupe.id,
                    nomGroupe: session.groupe.nom,
                    realDate: Timestamp.fromDate(session.dateObj),
                    status: { [student.id]: 'absent_announced' },
                    updatedAt: serverTimestamp()
                }, { merge: true });
                batch.update(studentRef, { absARemplacer: increment(1) });
            } else {
                batch.update(ref, { [`status.${student.id}`]: deleteField() });
                batch.update(studentRef, { absARemplacer: increment(1) });
            }
            await batch.commit();
            refreshData();
        } catch (e) { console.error(e); alert("Erreur"); }
    };

    const handleUncancel = async () => {
        if (!selectedSession) return;
        const session = selectedSession;

        const soldeActuel = student.absARemplacer || 0;
        let msg = "Annuler l'absence et venir au cours (-1 crédit) ?";
        if (soldeActuel <= 0) {
            msg = `Annuler l'absence ?\nVotre solde est à ${soldeActuel}, il passera à ${soldeActuel - 1}.`;
        }

        if (!confirm(msg)) return;
        try {
            const batch = writeBatch(db);
            const ref = doc(db, "attendance", session.seanceId);
            const studentRef = doc(db, "eleves", student.id);
            batch.update(ref, { [`status.${student.id}`]: deleteField() });
            batch.update(studentRef, { absARemplacer: increment(-1) });
            await batch.commit();
            refreshData();
        } catch (e) { console.error(e); alert("Erreur"); }
    };

    const joinWaitingList = async () => {
        if (!selectedSession) return;
        const session = selectedSession;

        if (!confirm("Rejoindre la file d'attente ?")) return;
        try {
            const ref = doc(db, "attendance", session.seanceId);
            await setDoc(ref, {
                date: session.dateStr,
                groupeId: session.groupe.id,
                nomGroupe: session.groupe.nom,
                realDate: Timestamp.fromDate(session.dateObj),
                waitingList: arrayUnion(student.id)
            }, { merge: true });
            alert("Ajouté !");
            refreshData();
        } catch (e) { console.error(e); }
    };

    if (!student) {
        return ( /* ... LOGIN SCREEN inchangé ... */
            <div className="min-h-screen flex items-center justify-center bg-teal-50 p-4">
                <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md">
                    <h1 className="text-3xl font-playfair font-bold text-teal-800 mb-6 text-center">Espace Élève 🧘</h1>
                    <form onSubmit={handleLogin} className="space-y-4">
                        <input type="email" className="w-full border p-3 rounded-lg" placeholder="Votre Email" value={email} onChange={e => setEmail(e.target.value)} required />
                        <button disabled={loading} className="w-full bg-teal-900 text-white font-bold py-3 rounded-lg hover:bg-teal-800 shadow-xl transition-all mt-4 border border-teal-950">
                            {loading ? 'Connexion...' : 'Connexion'}
                        </button>
                    </form>
                    <div className="mt-6 text-center pt-4 border-t border-gray-100">
                        <Link to="/admin" className="text-sm font-bold text-teal-600 hover:underline">🔒 Accès Professeur</Link>
                    </div>
                </div>
            </div>
        );
    }

    const dimancheFin = ajouterJours(lundiActuel, 6);
    const isDebt = (student.absARemplacer || 0) < 0;
    const soldeClass = isDebt ? "bg-red-100 text-red-800 border-red-200" : "bg-teal-100 text-teal-800 border-teal-200";

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            {/* HEADER */}
            <header className="bg-white border-b sticky top-0 z-30 shadow-sm px-4 py-3 flex justify-between items-center">
                <div className="flex items-center gap-4">
                    <h1 className="font-playfair font-bold text-xl text-teal-900">{student.prenom} {student.nom}</h1>
                    <span className={`hidden md:inline-block text-xs font-bold px-3 py-1 rounded-full border ${soldeClass}`}>
                        Solde : {student.absARemplacer} crédit(s)
                    </span>
                </div>

                <div className="flex items-center bg-gray-100 rounded-lg p-1">
                    <button onClick={() => setLundiActuel(prev => ajouterJours(prev, -7))} className="w-8 h-8 rounded hover:bg-white text-gray-600 font-bold">←</button>
                    <span className="text-xs font-bold text-gray-700 px-3 uppercase hidden sm:block">
                        {lundiActuel.getDate()} {lundiActuel.toLocaleDateString('fr-FR', { month: 'short' })} - {dimancheFin.getDate()} {dimancheFin.toLocaleDateString('fr-FR', { month: 'short' })}
                    </span>
                    <button onClick={() => setLundiActuel(prev => ajouterJours(prev, 7))} className="w-8 h-8 rounded hover:bg-white text-gray-600 font-bold">→</button>
                </div>

                <div className="flex items-center gap-3">
                    <span className={`md:hidden text-xs font-bold px-2 py-1 rounded-full ${soldeClass}`}>
                        {student.absARemplacer} Cr.
                    </span>
                    <button onClick={() => setStudent(null)} className="text-sm font-bold text-red-500 hover:bg-red-50 px-3 py-1 rounded transition">
                        Sortir
                    </button>
                </div>
            </header>

            <main className="flex-1 overflow-auto p-2 md:p-6 relative">

                {loading && <div className="text-center py-10 text-gray-400">Chargement...</div>}

                {/* VUE MOBILE */}
                <div className="block md:hidden space-y-4 pb-20">
                    {[0, 1, 2, 3, 4, 5, 6].map(offset => {
                        const dateJour = ajouterJours(lundiActuel, offset);
                        const sessions = sessionsSemaine.filter(s => s.dateObj.toDateString() === dateJour.toDateString());
                        if (sessions.length === 0) return null;

                        return (
                            <div key={offset} className="pl-3 border-l-2 border-gray-200 relative">
                                <div className="absolute -left-[5px] top-0 w-2 h-2 rounded-full bg-teal-500"></div>
                                <h3 className="font-bold text-gray-500 mb-2 uppercase text-xs">{JOURS[dateJour.getDay()]} {dateJour.getDate()}</h3>
                                <div className="space-y-2">
                                    {sessions.map(sess => {
                                        let bg = "bg-white border-gray-200";
                                        let centerText = null;

                                        if (sess.estInscritRecurrent) {
                                            if (sess.isMeAbsent) {
                                                bg = "bg-orange-50 border-orange-300";
                                                centerText = "ABSENT";
                                            } else {
                                                bg = "bg-teal-50 border-teal-300";
                                                centerText = "INSCRIT";
                                            }
                                        } else if (sess.isMeGuest) {
                                            bg = "bg-purple-50 border-purple-300";
                                            centerText = "RÉSERVÉ";
                                        }

                                        return (
                                            <div key={sess.seanceId} onClick={() => openSessionDetails(sess)} className={`p-3 rounded-lg border shadow-sm ${bg} active:scale-95 transition-transform flex justify-between items-center`}>
                                                <div>
                                                    <div className="font-bold text-gray-800">{sess.groupe.nom}</div>
                                                    <div className="text-xs font-mono text-gray-500">{sess.groupe.heureDebut}</div>
                                                    <div className={`text-xs mt-1 ${sess.placesRestantes > 0 ? "text-green-600" : "text-red-500"}`}>
                                                        {getPlacesLabel(sess.placesRestantes)}
                                                    </div>
                                                </div>
                                                {centerText && (
                                                    <span className="text-xs font-black uppercase tracking-wider px-2 py-1 rounded bg-white/50 border border-black/10">
                                                        {centerText}
                                                    </span>
                                                )}
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        )
                    })}
                </div>

                {/* VUE DESKTOP */}
                <div className="hidden md:flex bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden relative min-h-[600px]">
                    <div className="w-16 bg-gray-50 border-r border-gray-200 flex-shrink-0 relative" style={{ height: (HEURE_FIN - HEURE_DEBUT) * PIXELS_PAR_HEURE }}>
                        {Array.from({ length: HEURE_FIN - HEURE_DEBUT }).map((_, i) => (
                            <div key={i} className="absolute w-full text-center text-xs text-gray-400 font-bold border-b border-gray-100" style={{ top: i * PIXELS_PAR_HEURE, height: PIXELS_PAR_HEURE }}>
                                {i + HEURE_DEBUT}:00
                            </div>
                        ))}
                    </div>

                    <div className="flex-1 grid grid-cols-7 divide-x divide-gray-200">
                        {[1, 2, 3, 4, 5, 6, 0].map((jourIndex) => {
                            const dateJour = ajouterJours(lundiActuel, jourIndex === 0 ? 6 : jourIndex - 1);
                            const isToday = new Date().toDateString() === dateJour.toDateString();
                            const sessions = sessionsSemaine.filter(s => s.dateObj.getDay() === jourIndex);

                            return (
                                <div key={jourIndex} className={`relative ${isToday ? 'bg-teal-50/10' : ''}`} style={{ height: (HEURE_FIN - HEURE_DEBUT) * PIXELS_PAR_HEURE }}>
                                    <div className={`text-center py-2 border-b border-gray-200 sticky top-0 z-10 ${isToday ? 'bg-teal-100 text-teal-900 font-bold' : 'bg-gray-50 text-gray-600'}`}>
                                        <div className="text-xs uppercase tracking-wide">{JOURS[jourIndex].substring(0, 3)}</div>
                                        <div className="text-lg">{dateJour.getDate()}</div>
                                    </div>
                                    {Array.from({ length: HEURE_FIN - HEURE_DEBUT }).map((_, i) => (
                                        <div key={i} className="absolute w-full border-b border-gray-100" style={{ top: i * PIXELS_PAR_HEURE, height: PIXELS_PAR_HEURE }}></div>
                                    ))}

                                    {sessions.map(sess => {
                                        const stylePos = getCardStyle(sess.groupe.heureDebut, sess.groupe.duree);
                                        const isFull = sess.placesRestantes <= 0;

                                        let containerClass = "hover:shadow-md cursor-pointer border-l-4 transition-all opacity-95 hover:opacity-100";
                                        let titleColor = "text-gray-700";
                                        let topBadge = null;
                                        let centerOverlay = null;

                                        if (sess.estInscritRecurrent) {
                                            if (sess.isMeAbsent) {
                                                containerClass += " bg-orange-50 border-orange-400";
                                                titleColor = "text-orange-900 line-through decoration-orange-300";
                                                topBadge = <span className="text-[9px] font-bold text-orange-600 bg-white/80 px-1 rounded">ABSENCE</span>;
                                                centerOverlay = <div className="text-orange-300/20 font-black text-2xl -rotate-12 select-none">ABSENT</div>;
                                            } else {
                                                containerClass += " bg-teal-50 border-teal-500";
                                                titleColor = "text-teal-900";
                                                topBadge = <span className="text-[9px] font-bold text-teal-700 bg-white/80 px-1 rounded">HEBDOMADAIRE</span>;
                                                centerOverlay = (
                                                    <div className="bg-white/90 px-3 py-1 rounded-lg border-2 border-teal-600 shadow-sm flex items-center gap-1 z-10">
                                                        <span className="text-teal-700 font-black text-sm md:text-base tracking-widest">INSCRIT</span>
                                                        <span className="text-teal-600 text-xs">✅</span>
                                                    </div>
                                                );
                                            }
                                        } else if (sess.isMeGuest) {
                                            containerClass += " bg-purple-50 border-purple-500";
                                            titleColor = "text-purple-900";
                                            topBadge = <span className="text-[9px] font-bold text-purple-700 bg-white/80 px-1 rounded">EXCEPTIONNEL</span>;
                                            centerOverlay = (
                                                <div className="bg-white/90 px-3 py-1 rounded-lg border-2 border-purple-600 shadow-sm flex items-center gap-1 z-10">
                                                    <span className="text-purple-700 font-black text-sm md:text-base tracking-widest">RÉSERVÉ</span>
                                                    <span className="text-purple-600 text-xs">🎉</span>
                                                </div>
                                            );
                                        } else {
                                            if (isFull) {
                                                containerClass += " bg-gray-50 border-gray-300 opacity-60";
                                                titleColor = "text-gray-400";
                                            } else {
                                                containerClass += " bg-white border-gray-200 hover:border-teal-300";
                                                titleColor = "text-gray-800";
                                            }
                                            if (sess.isInWaitingList) {
                                                containerClass = "bg-orange-50 border-orange-300 border-dashed";
                                                centerOverlay = <div className="bg-orange-100 text-orange-800 font-bold px-2 py-1 rounded text-xs z-10">EN ATTENTE 🕒</div>;
                                            }
                                        }

                                        return (
                                            <div
                                                key={sess.seanceId}
                                                onClick={() => openSessionDetails(sess)}
                                                className={`absolute left-1 right-1 rounded-md p-2 overflow-hidden flex flex-col justify-between ${containerClass}`}
                                                style={stylePos}
                                            >
                                                <div className="relative z-0">
                                                    <div className="flex justify-between items-start">
                                                        {topBadge}
                                                    </div>
                                                    <div className={`font-bold text-xs leading-tight truncate mt-0.5 ${titleColor}`}>
                                                        {sess.groupe.nom}
                                                    </div>
                                                    <div className="text-[10px] text-gray-500 font-mono">
                                                        {sess.groupe.heureDebut}
                                                    </div>
                                                </div>

                                                {centerOverlay && (
                                                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                                        {centerOverlay}
                                                    </div>
                                                )}

                                                <div className="relative z-0 flex justify-between items-end border-t border-black/5 pt-1 mt-1">
                                                    <div className={`text-[10px] font-bold ${isFull && !sess.estInscritRecurrent && !sess.isMeGuest ? 'text-red-500' : 'text-green-600'}`}>
                                                        {getPlacesLabel(sess.placesRestantes)}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </main>

            {/* --- MODALE DÉTAILS SÉANCE --- */}
            {selectedSession && (
                <StudentSessionDetail
                    session={selectedSession}
                    student={student}
                    onClose={() => setSelectedSession(null)}
                    onUpdate={refreshData} // Fonction qui recharge le planning global
                />
            )}
        </div>
    );
}