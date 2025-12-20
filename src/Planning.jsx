import { useState, useEffect } from 'react';
import { db } from './firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';
import GestionSeance from './GestionSeance';
import AjoutSeance from './AjoutSeance';
import GestionGroupes from './GestionGroupes';

const JOURS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
const MOIS = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc"];

// --- CONFIGURATION CALENDRIER ---
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

const formaterDateSimple = (date) => `${date.getDate()} ${MOIS[date.getMonth()]}`;

export default function Planning() {
    // --- ÉTATS ---
    const [coursAffiches, setCoursAffiches] = useState([]);
    const [donneesBrutes, setDonneesBrutes] = useState({ groupes: [], eleves: [], exceptions: [], attendances: [] });
    const [loading, setLoading] = useState(true);
    const [lundiActuel, setLundiActuel] = useState(getLundi(new Date()));

    // --- MODES D'AFFICHAGE (Nouveau) ---
    const [selectedStudentId, setSelectedStudentId] = useState(""); // Si vide = Vue Professeur

    // --- MODALES & SÉLECTIONS ---
    const [groupeAEditerId, setGroupeAEditerId] = useState(null);
    const [seanceSelectionnee, setSeanceSelectionnee] = useState(null);
    const [showAjoutModal, setShowAjoutModal] = useState(false);
    const [showGestionGroupes, setShowGestionGroupes] = useState(false);
    const [exceptionAEditer, setExceptionAEditer] = useState(null);
    const [choixCreation, setChoixCreation] = useState(null); // { date, heure }

    // --- CHARGEMENT INITIAL ---
    useEffect(() => {
        fetchDonnees();
    }, [lundiActuel]);

    const fetchDonnees = async () => {
        try {
            setLoading(true);
            const debutSemaineStr = lundiActuel.toLocaleDateString('fr-CA');
            const finSemaine = ajouterJours(lundiActuel, 6);
            const finSemaineStr = finSemaine.toLocaleDateString('fr-CA');

            // Chargement parallèle pour optimiser
            const [groupesSnap, elevesSnap, exceptionsSnap, attendanceSnap] = await Promise.all([
                getDocs(query(collection(db, "groupes"), where("actif", "==", true))),
                getDocs(collection(db, "eleves")),
                getDocs(collection(db, "exceptions")),
                getDocs(query(collection(db, "attendance"), where("date", ">=", debutSemaineStr), where("date", "<=", finSemaineStr)))
            ]);

            const elevesData = elevesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
            elevesData.sort((a, b) => a.nom.localeCompare(b.nom)); // Tri pour le menu déroulant

            setDonneesBrutes({
                groupes: groupesSnap.docs.map(d => ({ id: d.id, ...d.data() })),
                eleves: elevesData,
                exceptions: exceptionsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
                attendances: attendanceSnap.docs.map(d => ({ id: d.id, ...d.data() }))
            });
        } catch (error) {
            console.error("Erreur chargement:", error);
        } finally {
            setLoading(false);
        }
    };

    // --- CALCUL DU PLANNING ---
    // Déclenché quand les données changent OU quand on change d'élève sélectionné
    useEffect(() => {
        if (!loading) calculerPlanningDeLaSemaine();
    }, [lundiActuel, donneesBrutes, loading, selectedStudentId]);

    const calculerPlanningDeLaSemaine = () => {
        const { groupes, eleves, exceptions, attendances } = donneesBrutes;
        let listeFinale = [];
        const now = new Date();

        // Si un élève est sélectionné, on le récupère
        const selectedStudent = selectedStudentId ? eleves.find(e => e.id === selectedStudentId) : null;

        // Fonction helper locale pour calculer l'occupation ET le statut de l'élève cible
        const getStatsSeance = (groupeId, dateStr, isException, inscritsBase) => {
            const seanceId = isException ? groupeId : `${dateStr}_${groupeId}`;
            const attendanceDoc = attendances.find(a => a.id === seanceId);

            let nbAbsents = 0;
            let nbInvites = 0;
            let waitingCount = 0;

            // Statut spécifique de l'élève regardé (si actif)
            let studentStatus = { enrolled: false, absent: false, guest: false, waiting: false, waitingPos: null };

            // 1. Est-il inscrit de base ?
            if (selectedStudent && !isException) {
                studentStatus.enrolled = selectedStudent.enrolledGroupIds && selectedStudent.enrolledGroupIds.includes(groupeId);
            }

            if (attendanceDoc) {
                const status = attendanceDoc.status || {};
                waitingCount = attendanceDoc.waitingList ? attendanceDoc.waitingList.length : 0;

                // Vérif file d'attente
                if (selectedStudent && attendanceDoc.waitingList && attendanceDoc.waitingList.includes(selectedStudent.id)) {
                    studentStatus.waiting = true;
                    studentStatus.waitingPos = attendanceDoc.waitingList.indexOf(selectedStudent.id) + 1;
                }

                Object.entries(status).forEach(([uid, st]) => {
                    const eleve = eleves.find(e => e.id === uid);
                    if (!eleve) return; // Sécurité

                    // Est-ce un titulaire ?
                    const estInscrit = !isException && eleve.enrolledGroupIds && eleve.enrolledGroupIds.includes(groupeId);

                    if (estInscrit && (st === 'absent' || st === 'absent_announced')) {
                        nbAbsents++;
                        if (selectedStudent && uid === selectedStudent.id) studentStatus.absent = true;
                    }
                    if (!estInscrit && st === 'present') {
                        nbInvites++;
                        if (selectedStudent && uid === selectedStudent.id) studentStatus.guest = true;
                    }
                });
            }

            return {
                reel: inscritsBase - nbAbsents + nbInvites,
                waitingCount,
                studentStatus // On retourne l'objet statut
            };
        };

        // 1. Traitement des Groupes Récurrents
        groupes.forEach(groupe => {
            const dateDuCours = ajouterJours(lundiActuel, groupe.jour - 1);

            // Vérification Dates de saison
            if (groupe.dateDebut && groupe.dateFin) {
                const debut = groupe.dateDebut.toDate ? groupe.dateDebut.toDate() : new Date(groupe.dateDebut);
                const fin = groupe.dateFin.toDate ? groupe.dateFin.toDate() : new Date(groupe.dateFin);
                debut.setHours(0, 0, 0, 0); fin.setHours(23, 59, 59, 999);
                if (dateDuCours < debut || dateDuCours > fin) return;
            }

            const dateStr = dateDuCours.toLocaleDateString('fr-CA');

            // MODIFICATION ICI : Récupération de l'objet exception complet
            const exceptionAnnulation = exceptions.find(ex => ex.groupeId === groupe.id && ex.date === dateStr && ex.type === "annulation");
            const estAnnule = !!exceptionAnnulation;
            const motifAnnulation = exceptionAnnulation?.motif || "";

            const inscritsCount = eleves.filter(e => e.enrolledGroupIds && e.enrolledGroupIds.includes(groupe.id)).length;
            const stats = getStatsSeance(groupe.id, dateStr, false, inscritsCount);

            // Calcul si Passé
            const [h, min] = groupe.heureDebut.split(':').map(Number);
            const sessionEnd = new Date(dateDuCours);
            sessionEnd.setHours(h, min + (groupe.duree || 60), 0, 0);
            const isPast = now > sessionEnd;

            listeFinale.push({
                ...groupe,
                dateReelle: dateDuCours,
                type: 'standard',
                estAnnule,
                motifAnnulation, // On passe le motif
                inscritsCount,
                presentCount: stats.reel,
                waitingCount: stats.waitingCount,
                studentStatus: stats.studentStatus,
                isPast
            });
        });

        // 2. Traitement des Séances Exceptionnelles (Ajouts)
        const dimancheFinStr = ajouterJours(lundiActuel, 6).toLocaleDateString('fr-CA');
        const lundiDebutStr = lundiActuel.toLocaleDateString('fr-CA');
        const ajoutsSemaine = exceptions.filter(ex => ex.type === "ajout" && ex.date >= lundiDebutStr && ex.date <= dimancheFinStr);

        ajoutsSemaine.forEach(ajout => {
            const [y, m, d] = ajout.date.split('-').map(Number);
            const dateReelle = new Date(y, m - 1, d);
            const stats = getStatsSeance(ajout.id, ajout.date, true, 0);

            // Vérif si annulé (même une séance exceptionnelle peut être annulée via GestionSeance)
            const exceptionAnnulation = exceptions.find(ex => ex.groupeId === ajout.id && ex.date === ajout.date && ex.type === "annulation");
            const estAnnule = !!exceptionAnnulation;
            const motifAnnulation = exceptionAnnulation?.motif || "";

            // Calcul si Passé
            const [h, min] = ajout.newSessionData.heureDebut.split(':').map(Number);
            const sessionEnd = new Date(dateReelle);
            sessionEnd.setHours(h, min + (ajout.newSessionData.duree || 60), 0, 0);
            const isPast = now > sessionEnd;

            listeFinale.push({
                id: ajout.id,
                ...ajout.newSessionData,
                dateReelle,
                type: 'ajout',
                estAnnule,
                motifAnnulation, // On passe le motif
                inscritsCount: 0,
                presentCount: stats.reel,
                waitingCount: stats.waitingCount,
                originalExceptionId: ajout.id,
                studentStatus: stats.studentStatus,
                isPast
            });
        });

        // Tri chronologique
        listeFinale.sort((a, b) => a.dateReelle - b.dateReelle || a.heureDebut.localeCompare(b.heureDebut));
        setCoursAffiches(listeFinale);
    };

    // --- ACTIONS NAVIGATION ---
    const changerSemaine = (offset) => setLundiActuel(prev => ajouterJours(prev, offset * 7));

    // --- ACTIONS CLIC GRILLE ---
    const handleCellClick = (dateJour, heureInt) => {
        const heureStr = `${heureInt.toString().padStart(2, '0')}:00`;
        setChoixCreation({ date: dateJour, heure: heureStr });
    };

    const handleChoix = (type) => {
        if (type === 'hebdo') {
            setShowGestionGroupes(true);
        } else if (type === 'unique') {
            setExceptionAEditer({
                date: choixCreation.date.toLocaleDateString('fr-CA'),
                heureDebut: choixCreation.heure
            });
            setShowAjoutModal(true);
        }
        setChoixCreation(null);
    };

    const getCardStyle = (heureDebut, duree) => {
        const [h, m] = heureDebut.split(':').map(Number);
        const minutesDepuisDebut = (h - HEURE_DEBUT) * 60 + m;
        const top = (minutesDepuisDebut / 60) * PIXELS_PAR_HEURE;
        const height = (duree / 60) * PIXELS_PAR_HEURE;
        return { top: `${top}px`, height: `${height}px` };
    };

    const calculerHeureFin = (heureDebut, dureeMinutes) => {
        const [h, m] = heureDebut.split(':').map(Number);
        const date = new Date();
        date.setHours(h, m, 0, 0);
        date.setMinutes(date.getMinutes() + dureeMinutes);
        return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', 'h');
    };

    if (loading) return <div className="flex justify-center items-center h-64 text-teal-600 font-bold">Chargement...</div>;
    const dimancheFinSemaine = ajouterJours(lundiActuel, 6);

    return (
        <div className="max-w-7xl mx-auto p-2 md:p-6">

            {/* --- MODALE DE CHOIX CRÉATION (Clic grille) --- */}
            {choixCreation && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setChoixCreation(null)}>
                    <div className="bg-white p-6 rounded-2xl shadow-2xl w-80 text-center space-y-6" onClick={e => e.stopPropagation()}>
                        <div>
                            <h3 className="font-bold text-xl text-gray-800 font-playfair mb-1">Ajouter un créneau</h3>
                            <p className="text-sm text-gray-500 font-medium capitalize">
                                {choixCreation.date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric' })} • {choixCreation.heure}
                            </p>
                        </div>
                        <div className="flex flex-col gap-3">
                            <button onClick={() => handleChoix('hebdo')} className="p-4 bg-teal-50 text-teal-800 border border-teal-200 rounded-xl font-bold hover:bg-teal-100 transition flex items-center gap-3 text-left">
                                <span className="text-2xl">📅</span>
                                <div className="leading-tight">
                                    <span className="block text-sm">Cours Hebdomadaire</span>
                                    <span className="text-[10px] text-teal-600/70 uppercase">Récurrent toute l'année</span>
                                </div>
                            </button>
                            <button onClick={() => handleChoix('unique')} className="p-4 bg-purple-50 text-purple-800 border border-purple-200 rounded-xl font-bold hover:bg-purple-100 transition flex items-center gap-3 text-left">
                                <span className="text-2xl">✨</span>
                                <div className="leading-tight">
                                    <span className="block text-sm">Séance Exceptionnelle</span>
                                    <span className="text-[10px] text-purple-600/70 uppercase">Une seule fois (Atelier, etc.)</span>
                                </div>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* --- HEADER --- */}
            <div className="flex flex-col md:flex-row items-center justify-between mb-6 bg-white p-4 rounded-xl shadow-sm border border-gray-100 sticky top-0 z-20">
                <div className="flex flex-col gap-1 w-full md:w-auto">
                    <h2 className="text-xl md:text-2xl font-playfair font-bold text-gray-800 whitespace-nowrap">
                        {formaterDateSimple(lundiActuel)} - {formaterDateSimple(dimancheFinSemaine)}
                    </h2>

                    {/* SÉLECTEUR DE VUE (PROF ou ÉLÈVE) */}
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-gray-400 uppercase">Vue :</span>
                        <select
                            value={selectedStudentId}
                            onChange={(e) => setSelectedStudentId(e.target.value)}
                            className={`text-xs border rounded px-2 py-1 outline-none font-bold cursor-pointer transition ${selectedStudentId ? 'bg-purple-50 text-purple-800 border-purple-200' : 'bg-white text-gray-600 border-gray-300'}`}
                        >
                            <option value="">👨‍🏫 Mon Planning Prof</option>
                            <optgroup label="👁️ Voir en tant que...">
                                {donneesBrutes.eleves.map(e => (
                                    <option key={e.id} value={e.id}>{e.nom} {e.prenom}</option>
                                ))}
                            </optgroup>
                        </select>
                    </div>
                </div>

                <div className="flex items-center bg-gray-100 rounded-lg p-1 mt-3 md:mt-0">
                    <button onClick={() => changerSemaine(-1)} className="px-4 py-1 hover:bg-white rounded-md text-gray-600 font-bold">←</button>
                    <button onClick={() => setLundiActuel(getLundi(new Date()))} className="px-4 py-1 text-teal-700 font-bold text-sm uppercase">Auj.</button>
                    <button onClick={() => changerSemaine(1)} className="px-4 py-1 hover:bg-white rounded-md text-gray-600 font-bold">→</button>
                </div>
            </div>

            {/* VUE MOBILE */}
            <div className="block md:hidden space-y-4">
                {coursAffiches.map((groupe) => {
                    const taux = groupe.presentCount / groupe.places;
                    const estComplet = taux >= 1;

                    // Style de base Mobile
                    let borderClass = 'border-teal-500';
                    let opacityClass = '';

                    if (groupe.estAnnule) {
                        borderClass = 'border-red-400';
                        opacityClass = 'opacity-75';
                    } else if (groupe.isPast) {
                        borderClass = 'border-gray-400';
                        opacityClass = 'opacity-60 grayscale'; // GRISÉ SI PASSÉ
                    } else if (estComplet) {
                        borderClass = 'border-red-500';
                    }

                    // Badge spécial si vue élève
                    let mobileBadge = null;
                    if (selectedStudentId && !groupe.estAnnule) {
                        const s = groupe.studentStatus;
                        if (s.enrolled) {
                            if (s.absent) mobileBadge = <span className="text-[10px] bg-orange-100 text-orange-700 px-2 py-0.5 rounded border border-orange-200 font-bold ml-2">ABSENT</span>;
                            else mobileBadge = <span className="text-[10px] bg-teal-100 text-teal-700 px-2 py-0.5 rounded border border-teal-200 font-bold ml-2">INSCRIT</span>;
                        } else if (s.guest) {
                            mobileBadge = <span className="text-[10px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded border border-purple-200 font-bold ml-2">RÉSERVÉ</span>;
                        } else if (s.waiting) {
                            mobileBadge = <span className="text-[10px] bg-orange-50 text-orange-600 px-2 py-0.5 rounded border border-orange-100 font-bold ml-2">ATTENTE {s.waitingPos}</span>;
                        }
                    }

                    return (
                        <div key={groupe.id + groupe.dateReelle.toString()} className={`bg-white rounded-lg shadow border-l-4 p-4 flex justify-between items-center ${borderClass} ${opacityClass}`}>
                            <div>
                                <div className="text-xs uppercase text-gray-400 font-bold mb-1 flex items-center">
                                    {JOURS[groupe.dateReelle.getDay()]} {groupe.dateReelle.getDate()} • {groupe.heureDebut}
                                    {mobileBadge}
                                </div>
                                <h3 className={`font-bold text-lg ${groupe.estAnnule ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                                    {groupe.nom}
                                </h3>
                                {/* Affichage Thème Mobile */}
                                {groupe.theme && <div className="text-xs text-purple-600 italic mb-1">"{groupe.theme}"</div>}

                                {/* MODIFICATION : Affichage Motif Annulation Mobile */}
                                {groupe.estAnnule && groupe.motifAnnulation && (
                                    <div className="text-xs text-red-500 font-bold italic mt-1">
                                        "{groupe.motifAnnulation}"
                                    </div>
                                )}

                                <div className="text-sm mt-1">
                                    {groupe.estAnnule ? (
                                        <span className="text-red-500 font-bold">ANNULÉ</span>
                                    ) : (
                                        <span className={`${estComplet && !groupe.isPast ? 'text-red-600 font-bold' : 'text-gray-600'}`}>
                                            👥 {groupe.presentCount} / {groupe.places}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <button onClick={() => setSeanceSelectionnee({ groupe: groupe, date: groupe.dateReelle })} className="bg-gray-50 text-gray-600 px-3 py-2 rounded border font-bold text-sm">
                                Gérer
                            </button>
                        </div>
                    );
                })}
                {coursAffiches.length === 0 && <div className="text-center py-10 text-gray-400">Aucun cours cette semaine.</div>}
            </div>

            {/* VUE DESKTOP */}
            <div className="hidden md:flex bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden relative">

                {/* COLONNE HEURES */}
                <div className="w-16 bg-gray-50 border-r border-gray-200 flex-shrink-0 relative" style={{ height: (HEURE_FIN - HEURE_DEBUT) * PIXELS_PAR_HEURE }}>
                    {Array.from({ length: HEURE_FIN - HEURE_DEBUT }).map((_, i) => (
                        <div key={i} className="absolute w-full text-center text-xs text-gray-400 font-bold border-b border-gray-100" style={{ top: i * PIXELS_PAR_HEURE, height: PIXELS_PAR_HEURE }}>
                            {i + HEURE_DEBUT}:00
                        </div>
                    ))}
                </div>

                {/* GRILLE JOURS */}
                <div className="flex-1 grid grid-cols-7 divide-x divide-gray-200">
                    {[1, 2, 3, 4, 5, 6, 0].map((jourIndex) => {
                        const dateJour = ajouterJours(lundiActuel, jourIndex === 0 ? 6 : jourIndex - 1);
                        const isToday = new Date().toDateString() === dateJour.toDateString();
                        const coursDuJour = coursAffiches.filter(c => c.dateReelle.getDay() === jourIndex);

                        return (
                            <div key={jourIndex} className={`relative ${isToday ? 'bg-teal-50/20' : ''}`} style={{ height: (HEURE_FIN - HEURE_DEBUT) * PIXELS_PAR_HEURE }}>

                                {/* En-tête Jour */}
                                <div className={`text-center py-2 border-b border-gray-200 sticky top-0 z-10 ${isToday ? 'bg-teal-100 text-teal-900 font-bold' : 'bg-gray-50 text-gray-600'}`}>
                                    <div className="text-xs uppercase tracking-wide">{JOURS[jourIndex].substring(0, 3)}</div>
                                    <div className="text-lg">{dateJour.getDate()}</div>
                                </div>

                                {/* Lignes repères CLIQUABLES */}
                                {Array.from({ length: HEURE_FIN - HEURE_DEBUT }).map((_, i) => (
                                    <div
                                        key={i}
                                        onClick={() => handleCellClick(dateJour, i + HEURE_DEBUT)}
                                        className="absolute w-full border-b border-gray-100 cursor-cell hover:bg-gray-50 transition-colors z-0"
                                        style={{ top: i * PIXELS_PAR_HEURE, height: PIXELS_PAR_HEURE }}
                                        title="Cliquez pour ajouter un cours"
                                    ></div>
                                ))}

                                {/* CARTES COURS */}
                                {coursDuJour.map(groupe => {
                                    const stylePos = getCardStyle(groupe.heureDebut, groupe.duree);
                                    const isFull = groupe.presentCount >= groupe.places;

                                    // --- LOGIQUE COULEURS & STYLES ---
                                    let containerClass = "hover:shadow-md cursor-pointer border-l-4 transition-all opacity-95 hover:opacity-100 flex flex-col justify-between";
                                    let titleColor = "text-gray-700";

                                    if (groupe.estAnnule) {
                                        containerClass += " bg-gray-100 border-gray-400 opacity-60 text-gray-500";
                                    } else if (groupe.isPast) {
                                        // GRISÉ si passé (mais toujours cliquable pour le prof)
                                        containerClass += " bg-gray-100 border-gray-300 opacity-70 grayscale";
                                        titleColor = "text-gray-500";
                                    } else {
                                        // MODE ÉLÈVE SÉLECTIONNÉ : On imite la vue élève
                                        if (selectedStudentId) {
                                            if (groupe.type === 'ajout') containerClass += " bg-purple-50/50 border-purple-200"; // Violet base
                                            else if (isFull) containerClass += " bg-red-50/50 border-red-200"; // Rouge base
                                            else containerClass += " bg-teal-50/30 border-teal-200"; // Vert base
                                        }
                                        // MODE PROF STANDARD : Couleurs par défaut
                                        else {
                                            if (groupe.type === 'ajout') { containerClass += " bg-purple-50 border-purple-500 hover:bg-purple-100"; titleColor = "text-purple-900"; }
                                            else if (isFull) { containerClass += " bg-red-50 border-red-500 hover:bg-red-100"; titleColor = "text-red-900"; }
                                            else { containerClass += " bg-teal-50 border-teal-500 hover:bg-teal-100"; titleColor = "text-teal-900"; }
                                        }
                                    }

                                    // OVERLAYS (Uniquement si un élève est sélectionné)
                                    let topBadge = null;
                                    let centerOverlay = null;

                                    if (selectedStudentId && !groupe.estAnnule) {
                                        const s = groupe.studentStatus;
                                        // On réplique la logique StudentPortal
                                        if (s.enrolled) {
                                            if (s.absent) centerOverlay = <div className="text-orange-600/80 bg-orange-100/90 px-2 py-1 rounded font-black text-xs -rotate-12 border-2 border-orange-300">ABSENT</div>;
                                            else centerOverlay = <div className="bg-white px-2 py-1 rounded border-2 border-teal-600 shadow-sm flex items-center gap-1 z-10"><span className="text-teal-700 font-black text-xs">INSCRIT</span></div>;
                                        } else if (s.guest) {
                                            centerOverlay = <div className="bg-white px-2 py-1 rounded border-2 border-purple-600 shadow-sm flex items-center gap-1 z-10"><span className="text-purple-700 font-black text-xs">RÉSERVÉ</span></div>;
                                        } else if (s.waiting) {
                                            centerOverlay = <div className="bg-orange-100 text-orange-800 font-bold px-2 py-1 rounded text-xs z-10 border border-orange-200">File d'attente :  {s.waitingPos}e</div>;
                                        }
                                    }

                                    // Badge "Spécial" (pour mode prof ou élève)
                                    if (groupe.type === 'ajout' && !groupe.isPast && !groupe.estAnnule && !centerOverlay) {
                                        topBadge = <span className="text-[9px] font-bold text-purple-700 bg-white/80 px-1 rounded">SPÉCIAL</span>;
                                    }

                                    return (
                                        <div
                                            key={groupe.id}
                                            onClick={(e) => { e.stopPropagation(); setSeanceSelectionnee({ groupe: groupe, date: groupe.dateReelle }); }}
                                            className={`absolute left-1 right-1 rounded-md p-2 border-l-4 cursor-pointer transition-all shadow-sm hover:shadow-md overflow-hidden flex flex-col justify-between z-10 ${containerClass}`}
                                            style={stylePos}
                                            title={`${groupe.nom} (${groupe.heureDebut})`}
                                        >
                                            <div>
                                                <div className="flex justify-between items-start">
                                                    {/* Badge Spécial en haut à droite si nécessaire */}
                                                    <div className="w-full">
                                                        <div className={`font-bold text-xs md:text-sm leading-tight truncate ${titleColor}`}>
                                                            {groupe.estAnnule && "🚫 "}{groupe.nom}
                                                        </div>
                                                        <div className="text-[10px] opacity-80 font-mono mt-0.5">
                                                            {groupe.heureDebut.replace(':', 'h')} - {calculerHeureFin(groupe.heureDebut, groupe.duree)}
                                                        </div>
                                                        {/* MODIFICATION : Affichage Motif Annulation Desktop */}
                                                        {groupe.estAnnule && groupe.motifAnnulation && (
                                                            <div className="text-[10px] italic font-semibold text-gray-500 mt-1 leading-tight border-t border-gray-300 pt-0.5">
                                                                "{groupe.motifAnnulation}"
                                                            </div>
                                                        )}
                                                    </div>
                                                    {topBadge}
                                                </div>
                                                {/* Petit badge thème */}
                                                {groupe.theme && !groupe.estAnnule && (
                                                    <div className="text-[9px] italic mt-1 truncate opacity-90 border-t border-black/5 pt-0.5">
                                                        "{groupe.theme}"
                                                    </div>
                                                )}
                                            </div>

                                            {/* OVERLAY STATUT ÉLÈVE */}
                                            {centerOverlay && (
                                                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                                    {centerOverlay}
                                                </div>
                                            )}

                                            {!groupe.estAnnule && (
                                                <div className="flex justify-between items-end mt-1 pt-1 border-t border-black/5 relative z-0">
                                                    <div className="flex items-center gap-1">
                                                        <span className={`text-xs font-extrabold ${isFull && !groupe.isPast ? 'text-red-600' : 'opacity-100'}`}>
                                                            👥 {groupe.presentCount}/{groupe.places}
                                                        </span>
                                                    </div>
                                                    {groupe.waitingCount > 0 && (
                                                        <span className="text-[9px] font-bold bg-orange-200 text-orange-800 px-1.5 py-0.5 rounded-full">
                                                            +{groupe.waitingCount}
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* MODALES */}
            {seanceSelectionnee && (
                <GestionSeance
                    groupe={seanceSelectionnee.groupe}
                    date={seanceSelectionnee.date}
                    onClose={() => { setSeanceSelectionnee(null); fetchDonnees(); }}
                    onEdit={(groupeAEditer) => {
                        setSeanceSelectionnee(null); // On ferme la vue détail

                        if (groupeAEditer.type === 'ajout') {
                            // CAS 1 : C'est une exception (AjoutSeance)
                            setExceptionAEditer({
                                id: groupeAEditer.id,
                                type: 'ajout',
                                originalExceptionId: groupeAEditer.originalExceptionId,
                                date: groupeAEditer.dateReelle.toLocaleDateString('fr-CA'),
                                ...groupeAEditer
                            });
                            setShowAjoutModal(true);
                        } else {
                            // CAS 2 : C'est un cours récurrent (GestionGroupes)
                            setGroupeAEditerId(groupeAEditer.id); // On stocke l'ID
                            setShowGestionGroupes(true); // On ouvre la gestion
                        }
                    }}
                />
            )}
            {showAjoutModal && (
                <AjoutSeance
                    onClose={() => {
                        setShowAjoutModal(false);
                        setExceptionAEditer(null);
                    }}
                    onSuccess={() => fetchDonnees()}
                    initialData={exceptionAEditer}
                />
            )}
            {showGestionGroupes && (
                <GestionGroupes
                    onClose={() => {
                        setShowGestionGroupes(false);
                        setGroupeAEditerId(null); // Important : reset l'ID à la fermeture
                    }}
                    onUpdate={() => fetchDonnees()}
                    initialEditId={groupeAEditerId} // <-- ON PASSE L'ID ICI
                />
            )}
        </div>
    );
}