import { useState, useEffect } from 'react';
import { db } from './firebase';
import { Link } from 'react-router-dom';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import StudentSessionDetail from './StudentSessionDetail';
import Skeleton from './components/Skeleton';
import HistoryModal from './components/HistoryModal'; // <--- NOUVEL IMPORT

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

const getPlacesLabel = (count) => {
    if (count <= 0) return "Complet";
    if (count === 1) return "1 place";
    return `${count} places`;
};

export default function StudentPortal() {
    const [email, setEmail] = useState('');
    const [student, setStudent] = useState(null);
    const [loading, setLoading] = useState(false);

    // Loading spécifique pour le planning
    const [loadingPlanning, setLoadingPlanning] = useState(false);

    const [lundiActuel, setLundiActuel] = useState(getLundi(new Date()));
    const [sessionsSemaine, setSessionsSemaine] = useState([]);
    const [donneesGlobales, setDonneesGlobales] = useState(null);

    const [selectedSession, setSelectedSession] = useState(null);
    const [showHistory, setShowHistory] = useState(false); // <--- NOUVEAU STATE

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

    // --- CHARGEMENT PLANNING ---
    useEffect(() => {
        if (student && donneesGlobales) {
            calculerPlanningSemaine();
        }
    }, [student, lundiActuel, donneesGlobales]);

    const calculerPlanningSemaine = async () => {
        setLoadingPlanning(true);
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

        const ajouts = exceptions.filter(ex => ex.type === 'ajout');

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

            const ajoutsDuJour = ajouts.filter(a => a.date === dateStr).map(a => ({
                id: a.id,
                ...a.newSessionData,
                isExceptionnel: true,
                type: 'ajout'
            }));

            const tousLesCreneaux = [...groupesDuJour, ...ajoutsDuJour];

            tousLesCreneaux.forEach(groupe => {
                let estAnnule = false;

                if (!groupe.isExceptionnel) {
                    estAnnule = exceptions.some(ex => ex.groupeId === groupe.id && ex.date === dateStr && ex.type === "annulation");
                }

                const seanceId = groupe.isExceptionnel ? groupe.id : `${dateStr}_${groupe.id}`;
                const attendanceDoc = attendances.find(a => a.id === seanceId);

                const statusMap = attendanceDoc?.status || {};
                const waitingListIds = attendanceDoc?.waitingList || [];

                const recurrentsIds = (!groupe.isExceptionnel)
                    ? allEleves.filter(e => e.enrolledGroupIds && e.enrolledGroupIds.includes(groupe.id)).map(e => e.id)
                    : [];

                const participantsSet = new Set(recurrentsIds);
                Object.entries(statusMap).forEach(([uid, st]) => {
                    if (st === 'absent' || st === 'absent_announced') participantsSet.delete(uid);
                    else if (st === 'present') participantsSet.add(uid);
                });

                const participantsDetails = Array.from(participantsSet)
                    .map(uid => allEleves.find(e => e.id === uid))
                    .filter(Boolean);

                const occupiedCount = participantsDetails.length;
                const placesRestantes = groupe.places - occupiedCount;

                const waitingListDetails = waitingListIds.map(uid => allEleves.find(e => e.id === uid)).filter(Boolean);
                const myStatus = statusMap[student.id];
                const estInscritRecurrent = !groupe.isExceptionnel && student.enrolledGroupIds && student.enrolledGroupIds.includes(groupe.id);

                const isMeAbsent = estInscritRecurrent && (myStatus === 'absent' || myStatus === 'absent_announced');
                const isMeGuest = !estInscritRecurrent && myStatus === 'present';
                const isInWaitingList = waitingListIds.includes(student.id);

                const waitingListPosition = isInWaitingList ? waitingListIds.indexOf(student.id) + 1 : null;

                planning.push({
                    type: groupe.isExceptionnel ? 'ajout' : 'standard',
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
                    waitingListPosition,
                    participantsDetails,
                    waitingListDetails,
                    donneesGlobales,
                    isExceptionnel: !!groupe.isExceptionnel,
                    estAnnule
                });
            });
        }

        setSessionsSemaine(planning);
        setLoadingPlanning(false);
    };

    const refreshData = () => {
        setSelectedSession(null);
        setTimeout(() => {
            getDoc(doc(db, "eleves", student.id)).then(snap => {
                setStudent({ id: snap.id, ...snap.data() });
                calculerPlanningSemaine();
            });
        }, 500);
    };

    if (!student) {
        return (
            <div className="min-h-screen flex flex-col bg-white">
                <div className="flex-1 flex items-center justify-center p-4">
                    <div className="bg-white p-8 rounded-2xl shadow-2xl w-full max-w-md border border-gray-100">
                        <Link to="/" className="block text-center text-teal-800 font-bold mb-6 hover:underline">← Retour Accueil</Link>
                        <h1 className="text-3xl font-playfair font-bold text-teal-800 mb-6 text-center">Espace Élève 🧘</h1>
                        <form onSubmit={handleLogin} className="space-y-4">
                            <input type="email" className="w-full border p-3 rounded-lg focus:ring-2 focus:ring-teal-500 outline-none" placeholder="Votre Email" value={email} onChange={e => setEmail(e.target.value)} required />
                            <button disabled={loading} className="w-full bg-teal-900 text-white font-bold py-3 rounded-lg hover:bg-teal-800 shadow-xl transition-all mt-4">
                                {loading ? 'Connexion...' : 'Connexion'}
                            </button>
                        </form>
                    </div>
                </div>
            </div>
        );
    }

    const dimancheFin = ajouterJours(lundiActuel, 6);
    const isDebt = (student.absARemplacer || 0) < 0;
    const soldeClass = isDebt ? "bg-red-100 text-red-800 border-red-200" : "bg-teal-100 text-teal-800 border-teal-200";

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col font-sans">
            {/* HEADER */}
            <header className="bg-white border-b sticky top-0 z-30 shadow-sm px-4 py-3 flex justify-between items-center">
                <div className="flex items-center gap-4">
                    <h1 className="font-playfair font-bold text-xl text-teal-900">{student.prenom} {student.nom}</h1>

                    {/* BOUTON SOLDE CLIQUABLE */}
                    <button
                        onClick={() => setShowHistory(true)}
                        className={`hidden md:inline-flex items-center gap-2 text-xs font-bold px-3 py-1 rounded-full border transition hover:shadow-md cursor-pointer ${soldeClass}`}
                        title="Voir l'historique"
                    >
                        <span>Solde : {student.absARemplacer} séance(s)</span>
                        <span className="text-xs opacity-50">ℹ️</span>
                    </button>
                </div>

                <div className="flex items-center bg-gray-100 rounded-lg p-1">
                    <button onClick={() => setLundiActuel(prev => ajouterJours(prev, -7))} className="w-8 h-8 rounded hover:bg-white text-gray-600 font-bold">←</button>
                    <span className="text-xs font-bold text-gray-700 px-3 uppercase hidden sm:block">
                        {lundiActuel.getDate()} {lundiActuel.toLocaleDateString('fr-FR', { month: 'short' })} - {dimancheFin.getDate()} {dimancheFin.toLocaleDateString('fr-FR', { month: 'short' })}
                    </span>
                    <button onClick={() => setLundiActuel(prev => ajouterJours(prev, 7))} className="w-8 h-8 rounded hover:bg-white text-gray-600 font-bold">→</button>
                </div>

                <div className="flex items-center gap-3">
                    {/* SOLDE MOBILE */}
                    <button
                        onClick={() => setShowHistory(true)}
                        className={`md:hidden text-xs font-bold px-2 py-1 rounded-full border ${soldeClass}`}
                    >
                        {student.absARemplacer} Cr.
                    </button>

                    <Link to="/" className="text-gray-400 hover:text-teal-600 text-xs font-bold mr-2 hidden md:block">Accueil</Link>
                    <button onClick={() => setStudent(null)} className="text-sm font-bold text-red-500 hover:bg-red-50 px-3 py-1 rounded transition">
                        Sortir
                    </button>
                </div>
            </header>

            <main className="flex-1 overflow-auto p-2 md:p-6 relative">

                {/* VUE MOBILE */}
                <div className="block md:hidden space-y-4 pb-20">
                    {loadingPlanning ? (
                        <div className="space-y-6 p-4">
                            {[1, 2, 3].map(i => (
                                <div key={i} className="pl-3 border-l-2 border-gray-200 space-y-2">
                                    <Skeleton className="h-4 w-24 mb-2" />
                                    <Skeleton className="h-20 w-full rounded-lg" />
                                    <Skeleton className="h-20 w-full rounded-lg" />
                                </div>
                            ))}
                        </div>
                    ) : (
                        [0, 1, 2, 3, 4, 5, 6].map(offset => {
                            const dateJour = ajouterJours(lundiActuel, offset);
                            const sessions = sessionsSemaine.filter(s => s.dateObj.toDateString() === dateJour.toDateString());
                            if (sessions.length === 0) return null;

                            return (
                                <div key={offset} className="pl-3 border-l-2 border-gray-200 relative">
                                    <div className="absolute -left-[5px] top-0 w-2 h-2 rounded-full bg-teal-500"></div>
                                    <h3 className="font-bold text-gray-500 mb-2 uppercase text-xs">{JOURS[dateJour.getDay()]} {dateJour.getDate()}</h3>
                                    <div className="space-y-2">
                                        {sessions.map(sess => {
                                            if (sess.estAnnule) {
                                                return (
                                                    <div key={sess.seanceId} className="p-3 rounded-lg border border-gray-200 bg-gray-100 opacity-75 flex justify-between items-center">
                                                        <div>
                                                            <div className="font-bold text-gray-500 line-through decoration-gray-400">{sess.groupe.nom}</div>
                                                            <div className="text-xs font-mono text-gray-400">{sess.groupe.heureDebut}</div>
                                                        </div>
                                                        <span className="text-xs font-black uppercase text-red-500 border border-red-200 px-2 py-1 rounded bg-white">ANNULÉ</span>
                                                    </div>
                                                );
                                            }

                                            let bg = "bg-white border-gray-200";
                                            let centerText = null;

                                            if (sess.type === 'ajout') bg = "bg-purple-50/50 border-purple-200";

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
                                            } else if (sess.isInWaitingList) {
                                                bg = "bg-orange-50 border-orange-300 border-dashed";
                                                centerText = `ATTENTE ${sess.waitingListPosition}`;
                                            }

                                            return (
                                                <div key={sess.seanceId} onClick={() => setSelectedSession(sess)} className={`p-3 rounded-lg border shadow-sm ${bg} active:scale-95 transition-transform flex justify-between items-center cursor-pointer`}>
                                                    <div>
                                                        <div className="font-bold text-gray-800">{sess.groupe.nom}</div>
                                                        <div className="text-xs font-mono text-gray-500">{sess.groupe.heureDebut}</div>
                                                        {sess.groupe.theme && <div className="text-xs text-purple-600 italic mt-0.5">"{sess.groupe.theme}"</div>}
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
                        })
                    )}
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

                    <div className="flex-1 grid grid-cols-7 divide-x divide-gray-200 relative">

                        {loadingPlanning && (
                            <div className="absolute inset-0 z-50 bg-white/80 backdrop-blur-sm flex items-center justify-center">
                                <div className="flex flex-col items-center gap-3">
                                    <div className="w-12 h-12 border-4 border-teal-200 border-t-teal-600 rounded-full animate-spin"></div>
                                    <span className="text-teal-800 font-bold animate-pulse">Chargement du planning...</span>
                                </div>
                            </div>
                        )}

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

                                        if (sess.estAnnule) {
                                            return (
                                                <div
                                                    key={sess.seanceId}
                                                    className="absolute left-1 right-1 rounded-md p-2 overflow-hidden flex flex-col justify-center items-center z-20 bg-gray-100 border border-gray-300 opacity-80 cursor-not-allowed"
                                                    style={stylePos}
                                                >
                                                    <div className="text-xs font-bold text-gray-400 line-through decoration-gray-400 mb-1">{sess.groupe.nom}</div>
                                                    <div className="bg-white border border-red-200 text-red-500 font-black text-xs px-2 py-1 rounded shadow-sm transform -rotate-6">
                                                        ANNULÉ
                                                    </div>
                                                </div>
                                            );
                                        }

                                        const isFull = sess.placesRestantes <= 0;
                                        let containerClass = "hover:shadow-md cursor-pointer border-l-4 transition-all opacity-95 hover:opacity-100 flex flex-col justify-between";
                                        let titleColor = "text-gray-700";
                                        let topBadge = null;
                                        let centerOverlay = null;

                                        if (sess.type === 'ajout') {
                                            containerClass += " bg-purple-50/40 border-purple-300";
                                            titleColor = "text-purple-900";
                                            if (!sess.isMeGuest) topBadge = <span className="text-[9px] font-bold text-purple-700 bg-purple-100 px-1 rounded">SPÉCIAL</span>;
                                        } else {
                                            containerClass += " bg-white border-gray-200 hover:border-teal-300";
                                            titleColor = "text-gray-800";
                                        }

                                        if (sess.estInscritRecurrent) {
                                            if (sess.isMeAbsent) {
                                                containerClass = containerClass.replace('bg-white', 'bg-orange-50').replace('border-gray-200', 'border-orange-400');
                                                titleColor = "text-orange-900 line-through decoration-orange-300";
                                                topBadge = <span className="text-[9px] font-bold text-orange-600 bg-white/80 px-1 rounded">ABSENCE</span>;
                                                centerOverlay = <div className="text-orange-300/20 font-black text-2xl -rotate-12 select-none">ABSENT</div>;
                                            } else {
                                                containerClass = containerClass.replace('bg-white', 'bg-teal-50').replace('border-gray-200', 'border-teal-500');
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
                                            containerClass = "bg-purple-50 border-purple-500 border-l-4 " + containerClass.split(' ').filter(c => !c.startsWith('bg-') && !c.startsWith('border-')).join(' ');
                                            titleColor = "text-purple-900";
                                            topBadge = <span className="text-[9px] font-bold text-purple-700 bg-white/80 px-1 rounded">RÉSERVÉ</span>;
                                            centerOverlay = (
                                                <div className="bg-white/90 px-3 py-1 rounded-lg border-2 border-purple-600 shadow-sm flex items-center gap-1 z-10">
                                                    <span className="text-purple-700 font-black text-sm md:text-base tracking-widest">RÉSERVÉ</span>
                                                    <span className="text-purple-600 text-xs">🎉</span>
                                                </div>
                                            );
                                        } else {
                                            if (isFull) {
                                                containerClass += " opacity-60";
                                                titleColor = "text-gray-400";
                                            }
                                            if (sess.isInWaitingList) {
                                                containerClass = "bg-orange-50 border-orange-300 border-dashed border-l-4";
                                                centerOverlay = (
                                                    <div className="bg-orange-100 text-orange-800 font-bold px-2 py-1 rounded text-xs z-10 shadow-sm border border-orange-200">
                                                        FILE D'ATTENTE : {sess.waitingListPosition}e
                                                    </div>
                                                );
                                            }
                                        }

                                        return (
                                            <div
                                                key={sess.seanceId}
                                                className={`absolute left-1 right-1 rounded-md p-2 overflow-hidden flex flex-col justify-between z-20 ${containerClass}`}
                                                style={stylePos}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setSelectedSession(sess);
                                                }}
                                            >
                                                <div className="relative z-0 pointer-events-none">
                                                    <div className="flex justify-between items-start">
                                                        {topBadge}
                                                    </div>
                                                    <div className={`font-bold text-xs leading-tight truncate mt-0.5 ${titleColor}`}>
                                                        {sess.groupe.nom}
                                                    </div>
                                                    <div className="text-[10px] text-gray-500 font-mono">
                                                        {sess.groupe.heureDebut}
                                                    </div>

                                                    {sess.groupe.theme && !sess.estInscritRecurrent && !sess.isMeGuest && (
                                                        <div className="text-[9px] text-purple-700 italic truncate mt-1 pt-1 border-t border-purple-100">
                                                            "{sess.groupe.theme}"
                                                        </div>
                                                    )}
                                                </div>

                                                {centerOverlay && (
                                                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                                        {centerOverlay}
                                                    </div>
                                                )}

                                                <div className="relative z-0 flex justify-between items-end border-t border-black/5 pt-1 mt-1 pointer-events-none">
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

            {/* MODALE DÉTAILS SÉANCE */}
            {selectedSession && (
                <StudentSessionDetail
                    session={selectedSession}
                    student={student}
                    onClose={() => setSelectedSession(null)}
                    onUpdate={refreshData}
                />
            )}

            {/* MODALE HISTORIQUE (NOUVEAU) */}
            {showHistory && (
                <HistoryModal
                    student={student}
                    onClose={() => setShowHistory(false)}
                />
            )}
        </div>
    );
}