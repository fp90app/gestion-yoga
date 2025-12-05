import { useState } from 'react';
import { db } from './firebase';
import { Link } from 'react-router-dom';
import {
    collection, query, where, getDocs, doc, getDoc, writeBatch, increment, serverTimestamp, Timestamp, arrayUnion, updateDoc, deleteField, setDoc
} from 'firebase/firestore';

const JOURS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];

const getNextDates = (dayIndex, count = 4) => {
    const dates = [];
    let d = new Date();
    d.setHours(0, 0, 0, 0);
    while (d.getDay() !== dayIndex) { d.setDate(d.getDate() + 1); }
    for (let i = 0; i < count; i++) {
        dates.push(new Date(d));
        d.setDate(d.getDate() + 7);
    }
    return dates;
};

export default function StudentPortal() {
    const [email, setEmail] = useState('');
    const [student, setStudent] = useState(null);
    const [mySessions, setMySessions] = useState([]);
    const [availableSessions, setAvailableSessions] = useState([]);
    const [loading, setLoading] = useState(false);
    const [activeTab, setActiveTab] = useState('planning');

    const handleLogin = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            const emailClean = email.trim().toLowerCase();
            const q = query(collection(db, "eleves"), where("email", "==", emailClean));
            const snap = await getDocs(q);

            if (snap.empty) {
                alert("Email inconnu.");
                setLoading(false);
                return;
            }

            const studentData = { id: snap.docs[0].id, ...snap.docs[0].data() };
            setStudent(studentData);
            await loadAllData(studentData);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const loadAllData = async (studentData) => {
        // 1. Récupérer toutes les données nécessaires
        const [groupsSnap, elevesSnap] = await Promise.all([
            getDocs(query(collection(db, "groupes"), where("actif", "==", true))),
            getDocs(collection(db, "eleves"))
        ]);

        const allGroups = groupsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const allEleves = elevesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        // Helper pour calculer les participants et les places
        // C'est ici que la magie opère pour avoir un compte EXACT
        const getSessionData = async (group, dateObj) => {
            const dateStr = dateObj.toLocaleDateString('fr-CA');
            const seanceId = `${dateStr}_${group.id}`;
            const snap = await getDoc(doc(db, "attendance", seanceId));

            const data = snap.exists() ? snap.data() : {};
            const statusMap = data.status || {};
            const waitingListIds = data.waitingList || [];

            // A. Identifier les inscrits de base (Récurrents)
            const recurrentsIds = allEleves
                .filter(e => e.enrolledGroupIds && e.enrolledGroupIds.includes(group.id))
                .map(e => e.id);

            // B. Construire la liste finale des présents (Set pour unicité)
            const participantsSet = new Set(recurrentsIds);

            // C. Appliquer les modifications de la feuille d'appel
            Object.entries(statusMap).forEach(([uid, status]) => {
                if (status === 'absent' || status === 'absent_announced') {
                    participantsSet.delete(uid); // On retire l'absent
                } else if (status === 'present') {
                    participantsSet.add(uid); // On ajoute l'invité (ou confirme le présent)
                }
            });

            // D. Générer la liste des noms pour l'affichage (Prénom + Initiale Nom)
            const participantsNoms = Array.from(participantsSet).map(uid => {
                const el = allEleves.find(e => e.id === uid);
                return el ? `${el.prenom} ${el.nom.charAt(0)}.` : 'Inconnu';
            });

            const occupiedCount = participantsSet.size;
            const placesRestantes = group.places - occupiedCount;

            // Infos utilisateur courant
            const myStatus = statusMap[studentData.id];
            const isMeGuest = myStatus === 'present' && !recurrentsIds.includes(studentData.id); // Vrai invité
            const isMeAbsent = myStatus === 'absent' || myStatus === 'absent_announced';
            const isInWaitingList = waitingListIds.includes(studentData.id);

            return {
                dateObj,
                dateStr,
                group,
                seanceId,
                status: myStatus || 'inscrit', // statut brut
                docExists: snap.exists(),
                waitingList: waitingListIds,

                // Données calculées
                participantsNoms,
                placesRestantes,
                isMeGuest,
                isMeAbsent,
                isInWaitingList
            };
        };

        // --- PARTIE 1 : MES SÉANCES (Là où je suis inscrit à l'année) ---
        const myGroups = allGroups.filter(g => studentData.enrolledGroupIds && studentData.enrolledGroupIds.includes(g.id));
        let promisesMySchedule = [];

        for (let group of myGroups) {
            const dates = getNextDates(group.jour, 4);
            for (let dateObj of dates) {
                promisesMySchedule.push(getSessionData(group, dateObj));
            }
        }
        const myResults = await Promise.all(promisesMySchedule);
        myResults.sort((a, b) => a.dateObj - b.dateObj);
        setMySessions(myResults);

        // --- PARTIE 2 : SÉANCES DISPONIBLES (Les autres groupes) ---
        let promisesBooking = [];

        for (let group of allGroups) {
            if (studentData.enrolledGroupIds && studentData.enrolledGroupIds.includes(group.id)) continue;
            const dates = getNextDates(group.jour, 4);
            for (let dateObj of dates) {
                promisesBooking.push(getSessionData(group, dateObj));
            }
        }

        const bookingRaw = await Promise.all(promisesBooking);
        // On affiche tout pour permettre la liste d'attente, trié par date
        bookingRaw.sort((a, b) => a.dateObj - b.dateObj);
        setAvailableSessions(bookingRaw);
    };

    // --- ACTIONS ---

    const joinWaitingList = async (session) => {
        if (!confirm(`Rejoindre la liste d'attente ?`)) return;
        try {
            const attendanceRef = doc(db, "attendance", session.seanceId);
            if (!session.docExists) {
                await setDoc(attendanceRef, {
                    date: session.dateStr,
                    groupeId: session.group.id,
                    nomGroupe: session.group.nom,
                    realDate: Timestamp.fromDate(session.dateObj),
                    status: {},
                    waitingList: [student.id],
                    updatedAt: serverTimestamp()
                }, { merge: true });
            } else {
                await updateDoc(attendanceRef, { waitingList: arrayUnion(student.id) });
            }
            alert("Ajouté à la file d'attente !");
            loadAllData(student);
        } catch (e) { console.error(e); alert("Erreur"); }
    };

    const reserverRattrapage = async (session) => {
        if (student.absARemplacer <= 0) { alert("Crédits insuffisants."); return; }
        if (!confirm(`Utiliser 1 crédit pour ${session.group.nom} ?`)) return;

        try {
            const batch = writeBatch(db);
            const attendanceRef = doc(db, "attendance", session.seanceId);
            const studentRef = doc(db, "eleves", student.id);

            batch.set(attendanceRef, {
                date: session.dateStr,
                groupeId: session.group.id,
                nomGroupe: session.group.nom,
                realDate: Timestamp.fromDate(session.dateObj),
                status: { [student.id]: 'present' },
                updatedAt: serverTimestamp()
            }, { merge: true });

            batch.update(studentRef, { absARemplacer: increment(-1) });
            await batch.commit();
            alert("Inscription validée !");
            loadAllData({ ...student, absARemplacer: student.absARemplacer - 1 });
        } catch (e) { console.error(e); alert("Erreur"); }
    };

    // NOUVELLE FONCTION : ANNULER UNE RÉSERVATION PONCTUELLE
    const annulerReservation = async (session) => {
        if (!confirm("Annuler votre inscription à ce cours ? (Votre crédit vous sera rendu)")) return;

        try {
            const batch = writeBatch(db);
            const attendanceRef = doc(db, "attendance", session.seanceId);
            const studentRef = doc(db, "eleves", student.id);

            // On retire le statut 'present' (deleteField supprime la clé de la Map)
            batch.update(attendanceRef, {
                [`status.${student.id}`]: deleteField()
            });

            // On rend le crédit
            batch.update(studentRef, { absARemplacer: increment(1) });

            await batch.commit();
            alert("Désinscription confirmée. Crédit remboursé.");
            loadAllData({ ...student, absARemplacer: (student.absARemplacer || 0) + 1 });

        } catch (e) {
            console.error(e);
            alert("Erreur lors de l'annulation.");
        }
    };

    const toggleAbsence = async (session) => {
        const isCurrentlyAbsent = session.isMeAbsent;
        const newStatus = isCurrentlyAbsent ? 'present' : 'absent_announced';
        const creditChange = isCurrentlyAbsent ? -1 : 1; // Si j'étais absent et je viens -> -1. Si je m'absente -> +1

        if (!confirm(isCurrentlyAbsent ? "Annuler l'absence et VENIR au cours ?" : "Signaler une absence (+1 crédit) ?")) return;

        try {
            const batch = writeBatch(db);
            const attendanceRef = doc(db, "attendance", session.seanceId);
            const studentRef = doc(db, "eleves", student.id);

            batch.set(attendanceRef, {
                date: session.dateStr,
                groupeId: session.group.id,
                nomGroupe: session.group.nom,
                realDate: Timestamp.fromDate(session.dateObj),
                status: { [student.id]: newStatus },
                updatedAt: serverTimestamp()
            }, { merge: true });

            batch.update(studentRef, { absARemplacer: increment(creditChange) });
            await batch.commit();

            // Notification simple (simulation) si on libère une place
            if (!isCurrentlyAbsent && session.waitingList && session.waitingList.length > 0) {
                alert(`Note : ${session.waitingList.length} personne(s) en attente ont été notifiées.`);
            }

            loadAllData({ ...student, absARemplacer: (student.absARemplacer || 0) + creditChange });
        } catch (e) { console.error(e); alert("Erreur"); }
    };

    if (!student) {
        // ... Login Form (Identique) ...
        return (
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

    return (
        <div className="min-h-screen bg-gray-50 pb-20">
            <header className="bg-teal-700 text-white p-6 shadow-md sticky top-0 z-10">
                <div className="max-w-md mx-auto">
                    <div className="flex justify-between items-center mb-4">
                        <h1 className="text-xl font-bold font-playfair">{student.prenom} {student.nom}</h1>
                        <button onClick={() => setStudent(null)} className="bg-red-600 text-white font-bold px-4 py-2 rounded-lg shadow hover:bg-red-700 transition border border-red-800 text-sm">Déconnexion</button>
                    </div>
                    <div className="flex justify-between items-center bg-teal-800/50 p-3 rounded-lg border border-teal-600">
                        <span className="text-teal-100 text-sm font-medium">Crédits de rattrapage</span>
                        <span className="font-bold text-white text-xl bg-teal-600 px-3 py-1 rounded-full shadow-sm border border-teal-400">{student.absARemplacer || 0}</span>
                    </div>
                </div>
            </header>

            <div className="max-w-md mx-auto mt-4 px-4 flex gap-2">
                <button onClick={() => setActiveTab('planning')} className={`flex-1 py-3 font-bold text-sm rounded-xl transition shadow-sm ${activeTab === 'planning' ? 'bg-white text-teal-800 border-2 border-teal-500' : 'bg-gray-200 text-gray-500 border border-transparent'}`}>Mes Cours</button>
                <button onClick={() => setActiveTab('booking')} className={`flex-1 py-3 font-bold text-sm rounded-xl transition shadow-sm ${activeTab === 'booking' ? 'bg-white text-purple-800 border-2 border-purple-500' : 'bg-gray-200 text-gray-500 border border-transparent'}`}>Réserver (+1 Crédit)</button>
            </div>

            <main className="max-w-md mx-auto p-4">
                {activeTab === 'planning' && (
                    <div className="space-y-4">
                        {mySessions.length === 0 && <p className="text-center text-gray-500 italic mt-8">Aucun cours régulier.</p>}
                        {mySessions.map((session) => {
                            return (
                                <div key={session.seanceId} className={`p-4 rounded-xl shadow-sm border flex flex-col gap-3 transition-all ${session.isMeAbsent ? 'bg-orange-50 border-orange-200' : 'bg-white border-gray-100'}`}>
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <div className="flex items-center gap-2 mb-1">
                                                {session.isMeAbsent ? <span className="text-[10px] font-bold text-orange-700 bg-orange-100 px-2 rounded-full border border-orange-200">🚫 Absent</span> : <span className="text-[10px] font-bold text-green-700 bg-green-100 px-2 rounded-full border border-green-200">✅ Inscrit</span>}
                                            </div>
                                            <div className={`font-bold text-lg ${session.isMeAbsent ? 'text-orange-800' : 'text-teal-800'}`}>{JOURS[session.dateObj.getDay()]} {session.dateObj.getDate()}</div>
                                            <div className="text-gray-500 text-xs">{session.group.nom} • {session.group.heureDebut}</div>
                                        </div>
                                        <button onClick={() => toggleAbsence(session)} className={`px-3 py-2 rounded-lg text-xs font-bold border shadow-sm ${session.isMeAbsent ? 'bg-white text-green-600 border-green-200' : 'bg-white text-orange-600 border-orange-200'}`}>
                                            {session.isMeAbsent ? "J'annule, je viens !" : "Je ne viens pas"}
                                        </button>
                                    </div>

                                    {/* LISTE DES PARTICIPANTS */}
                                    {!session.isMeAbsent && (
                                        <div className="pt-2 border-t border-dashed border-gray-200">
                                            <p className="text-[10px] uppercase font-bold text-gray-400 mb-1">Participants ({session.participantsNoms.length})</p>
                                            <div className="flex flex-wrap gap-1">
                                                {session.participantsNoms.map((nom, idx) => (
                                                    <span key={idx} className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{nom}</span>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}

                {activeTab === 'booking' && (
                    <div className="space-y-4">
                        <div className="bg-purple-50 p-4 rounded-xl border border-purple-200 text-purple-900 text-xs mb-4 shadow-sm">
                            ℹ️ Pour vous inscrire, utilisez 1 crédit.
                        </div>
                        {availableSessions.map(session => (
                            <div key={session.seanceId} className="bg-white p-4 rounded-xl shadow-sm border border-purple-100 flex flex-col gap-3">
                                <div className="flex justify-between items-start">
                                    <div>
                                        {session.isMeGuest && <span className="text-[10px] font-bold text-white bg-purple-600 px-2 py-0.5 rounded-full mb-1 inline-block">🎉 Inscrit</span>}
                                        <div className="font-bold text-gray-800 text-lg">{JOURS[session.dateObj.getDay()]} {session.dateObj.getDate()}</div>
                                        <div className="text-gray-500 text-sm">{session.dateObj.toLocaleDateString('fr-FR', { month: 'long' })}</div>
                                        <div className="text-xs text-purple-600 font-bold mt-1">{session.group.nom} • {session.group.heureDebut}</div>

                                        {!session.isMeGuest && (
                                            <div className={`text-xs mt-1 font-bold ${session.placesRestantes > 0 ? 'text-green-600' : 'text-red-500'}`}>
                                                {session.placesRestantes > 0 ? `${session.placesRestantes} place(s) dispo(s)` : 'COMPLET'}
                                            </div>
                                        )}
                                    </div>

                                    {/* BOUTONS D'ACTION */}
                                    {session.isMeGuest ? (
                                        // BOUTON ANNULATION POUR INVITÉ
                                        <button onClick={() => annulerReservation(session)} className="bg-red-50 text-red-600 px-3 py-2 rounded-lg text-xs font-bold border border-red-100 hover:bg-red-100">
                                            Se désinscrire
                                        </button>
                                    ) : session.isInWaitingList ? (
                                        <div className="flex flex-col items-center">
                                            <span className="text-xs font-bold text-orange-600 bg-orange-100 px-3 py-1 rounded-full border border-orange-200 animate-pulse">🕒 En attente</span>
                                        </div>
                                    ) : session.placesRestantes > 0 ? (
                                        <button onClick={() => reserverRattrapage(session)} className="bg-purple-600 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-purple-700 shadow-md flex flex-col items-center border-b-4 border-purple-800 active:border-b-0 active:mt-1">
                                            <span>Réserver</span>
                                            <span className="font-normal opacity-80 text-[10px]">-1 Crédit</span>
                                        </button>
                                    ) : (
                                        <button onClick={() => joinWaitingList(session)} className="bg-gray-800 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-gray-900 shadow-md border-b-4 border-black active:border-b-0 active:mt-1">
                                            File d'attente
                                        </button>
                                    )}
                                </div>

                                {/* LISTE DES PARTICIPANTS (Pour voir les affinités avant de réserver) */}
                                <div className="pt-2 border-t border-dashed border-purple-50">
                                    <p className="text-[10px] uppercase font-bold text-gray-400 mb-1">Participants ({session.participantsNoms.length})</p>
                                    <div className="flex flex-wrap gap-1">
                                        {session.participantsNoms.length > 0 ? session.participantsNoms.map((nom, idx) => (
                                            <span key={idx} className="text-[10px] bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full">{nom}</span>
                                        )) : <span className="text-[10px] text-gray-400 italic">Soyez le premier !</span>}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </main>
        </div>
    );
}