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
    const [coursAffiches, setCoursAffiches] = useState([]);
    const [donneesBrutes, setDonneesBrutes] = useState({ groupes: [], eleves: [], exceptions: [], attendances: [] });
    const [loading, setLoading] = useState(true);
    const [lundiActuel, setLundiActuel] = useState(getLundi(new Date()));
    const [groupeAEditerId, setGroupeAEditerId] = useState(null);

    // --- MODALES ---
    const [seanceSelectionnee, setSeanceSelectionnee] = useState(null);
    const [showAjoutModal, setShowAjoutModal] = useState(false);
    const [showGestionGroupes, setShowGestionGroupes] = useState(false);
    const [exceptionAEditer, setExceptionAEditer] = useState(null);

    // Menu choix création
    const [choixCreation, setChoixCreation] = useState(null);

    useEffect(() => { fetchDonnees(); }, [lundiActuel]);

    const fetchDonnees = async () => {
        try {
            setLoading(true);
            const debutSemaineStr = lundiActuel.toLocaleDateString('fr-CA');
            const finSemaine = ajouterJours(lundiActuel, 6);
            const finSemaineStr = finSemaine.toLocaleDateString('fr-CA');

            const [groupesSnap, elevesSnap, exceptionsSnap, attendanceSnap] = await Promise.all([
                getDocs(query(collection(db, "groupes"), where("actif", "==", true))),
                getDocs(collection(db, "eleves")),
                getDocs(collection(db, "exceptions")),
                getDocs(query(collection(db, "attendance"), where("date", ">=", debutSemaineStr), where("date", "<=", finSemaineStr)))
            ]);

            setDonneesBrutes({
                groupes: groupesSnap.docs.map(d => ({ id: d.id, ...d.data() })),
                eleves: elevesSnap.docs.map(d => ({ id: d.id, ...d.data() })),
                exceptions: exceptionsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
                attendances: attendanceSnap.docs.map(d => ({ id: d.id, ...d.data() }))
            });
        } catch (error) { console.error("Erreur:", error); } finally { setLoading(false); }
    };

    const calculerPlanningDeLaSemaine = () => {
        const { groupes, eleves, exceptions, attendances } = donneesBrutes;
        let listeFinale = [];

        // Fonction Helper pour récupérer les stats (Présents / Attente)
        // Correction : Ajout du paramètre isException pour gérer les IDs correctement
        const getStatsSeance = (groupeId, dateStr, isException, inscritsBase) => {
            // Si c'est une exception, l'ID dans attendance EST l'ID du document exception (groupeId)
            // Si c'est standard, l'ID est "YYYY-MM-DD_groupeId"
            const seanceId = isException ? groupeId : `${dateStr}_${groupeId}`;

            const attendanceDoc = attendances.find(a => a.id === seanceId);
            let nbAbsents = 0, nbInvites = 0, waitingCount = 0;

            if (attendanceDoc) {
                const status = attendanceDoc.status || {};
                waitingCount = attendanceDoc.waitingList ? attendanceDoc.waitingList.length : 0;
                Object.entries(status).forEach(([uid, st]) => {
                    const eleve = eleves.find(e => e.id === uid);
                    if (!eleve) return;

                    // Est-il inscrit officiellement ? (Toujours faux pour une exception)
                    const estInscrit = !isException && eleve.enrolledGroupIds && eleve.enrolledGroupIds.includes(groupeId);

                    if (estInscrit && (st === 'absent' || st === 'absent_announced')) {
                        nbAbsents++;
                    }
                    if (!estInscrit && st === 'present') {
                        nbInvites++;
                    }
                });
            }
            return { reel: inscritsBase - nbAbsents + nbInvites, waitingCount };
        };

        // 1. Récurrents (Standard)
        groupes.forEach(groupe => {
            const dateDuCours = ajouterJours(lundiActuel, groupe.jour - 1);

            if (groupe.dateDebut && groupe.dateFin) {
                const debut = groupe.dateDebut.toDate ? groupe.dateDebut.toDate() : new Date(groupe.dateDebut);
                const fin = groupe.dateFin.toDate ? groupe.dateFin.toDate() : new Date(groupe.dateFin);
                debut.setHours(0, 0, 0, 0);
                fin.setHours(23, 59, 59, 999);
                if (dateDuCours < debut || dateDuCours > fin) return;
            }

            const dateStr = dateDuCours.toLocaleDateString('fr-CA');
            const estAnnule = exceptions.some(ex => ex.groupeId === groupe.id && ex.date === dateStr && ex.type === "annulation");
            const inscritsCount = eleves.filter(e => e.enrolledGroupIds && e.enrolledGroupIds.includes(groupe.id)).length;

            // Appel stats pour standard (isException = false)
            const stats = getStatsSeance(groupe.id, dateStr, false, inscritsCount);

            listeFinale.push({
                ...groupe,
                dateReelle: dateDuCours,
                type: 'standard',
                estAnnule,
                inscritsCount,
                presentCount: stats.reel,
                waitingCount: stats.waitingCount
            });
        });

        // 2. Ajouts (Séances exceptionnelles) - CORRECTION MAJEURE ICI
        const dimancheFinStr = ajouterJours(lundiActuel, 6).toLocaleDateString('fr-CA');
        const lundiDebutStr = lundiActuel.toLocaleDateString('fr-CA');
        const ajoutsSemaine = exceptions.filter(ex => ex.type === "ajout" && ex.date >= lundiDebutStr && ex.date <= dimancheFinStr);

        ajoutsSemaine.forEach(ajout => {
            const [y, m, d] = ajout.date.split('-').map(Number);
            const dateReelle = new Date(y, m - 1, d);

            // Appel stats pour exception (isException = true). On passe ajout.id comme identifiant.
            const stats = getStatsSeance(ajout.id, ajout.date, true, 0);

            listeFinale.push({
                id: ajout.id, // L'ID du "groupe" devient l'ID du document exception
                ...ajout.newSessionData, // Spread (nom, theme, places, etc.)
                dateReelle,
                type: 'ajout',
                estAnnule: false,
                inscritsCount: 0,
                presentCount: stats.reel,
                waitingCount: stats.waitingCount,
                originalExceptionId: ajout.id
            });
        });

        listeFinale.sort((a, b) => a.dateReelle - b.dateReelle || a.heureDebut.localeCompare(b.heureDebut));
        setCoursAffiches(listeFinale);
    };

    useEffect(() => { if (!loading) calculerPlanningDeLaSemaine(); }, [lundiActuel, donneesBrutes, loading]);

    const changerSemaine = (offset) => setLundiActuel(prev => ajouterJours(prev, offset * 7));

    // --- GESTION DU CLIC SUR LA GRILLE ---
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

            {/* --- MODALE DE CHOIX CRÉATION --- */}
            {choixCreation && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setChoixCreation(null)}>
                    <div className="bg-white p-6 rounded-2xl shadow-2xl w-80 text-center space-y-6 animate-in fade-in zoom-in-95" onClick={e => e.stopPropagation()}>
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
                <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-start">
                    <h2 className="text-xl md:text-2xl font-playfair font-bold text-gray-800 whitespace-nowrap">
                        {formaterDateSimple(lundiActuel)} - {formaterDateSimple(dimancheFinSemaine)}
                    </h2>
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

                    return (
                        <div key={groupe.id + groupe.dateReelle.toString()} className={`bg-white rounded-lg shadow border-l-4 p-4 flex justify-between items-center ${groupe.estAnnule ? 'border-red-400 opacity-75' : (estComplet ? 'border-red-500' : 'border-teal-500')}`}>
                            <div>
                                <div className="text-xs uppercase text-gray-400 font-bold mb-1">
                                    {JOURS[groupe.dateReelle.getDay()]} {groupe.dateReelle.getDate()} • {groupe.heureDebut}
                                </div>
                                <h3 className={`font-bold text-lg ${groupe.estAnnule ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                                    {groupe.nom}
                                </h3>
                                {/* Affichage Thème Mobile */}
                                {groupe.theme && <div className="text-xs text-purple-600 italic mb-1">"{groupe.theme}"</div>}

                                <div className="text-sm mt-1">
                                    {groupe.estAnnule ? (
                                        <span className="text-red-500 font-bold">ANNULÉ</span>
                                    ) : (
                                        <span className={`${estComplet ? 'text-red-600 font-bold' : 'text-gray-600'}`}>
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
                                    const taux = groupe.presentCount / groupe.places;
                                    const estComplet = taux >= 1;

                                    let containerClass = "bg-teal-50 border-teal-500 hover:bg-teal-100 text-teal-900";
                                    if (groupe.estAnnule) containerClass = "bg-gray-100 border-gray-400 opacity-60 text-gray-500";
                                    else if (groupe.type === 'ajout') containerClass = "bg-purple-50 border-purple-500 hover:bg-purple-100 text-purple-900";
                                    else if (estComplet) containerClass = "bg-red-50 border-red-500 hover:bg-red-100 text-red-900";

                                    return (
                                        <div
                                            key={groupe.id}
                                            onClick={(e) => { e.stopPropagation(); setSeanceSelectionnee({ groupe: groupe, date: groupe.dateReelle }); }}
                                            className={`absolute left-1 right-1 rounded-md p-2 border-l-4 cursor-pointer transition-all shadow-sm hover:shadow-md overflow-hidden flex flex-col justify-between z-10 ${containerClass}`}
                                            style={stylePos}
                                            title={`${groupe.nom} (${groupe.heureDebut})`}
                                        >
                                            <div>
                                                <div className="font-bold text-xs md:text-sm leading-tight truncate">
                                                    {groupe.estAnnule && "🚫 "}{groupe.nom}
                                                </div>
                                                <div className="text-[10px] opacity-80 font-mono mt-0.5">
                                                    {groupe.heureDebut.replace(':', 'h')} - {calculerHeureFin(groupe.heureDebut, groupe.duree)}
                                                </div>
                                                {/* Petit badge thème si existe */}
                                                {groupe.theme && !groupe.estAnnule && (
                                                    <div className="text-[9px] italic mt-1 truncate opacity-90 border-t border-black/5 pt-0.5">
                                                        "{groupe.theme}"
                                                    </div>
                                                )}
                                            </div>

                                            {!groupe.estAnnule && (
                                                <div className="flex justify-between items-end mt-1 pt-1 border-t border-black/5">
                                                    <div className="flex items-center gap-1">
                                                        <span className={`text-xs font-extrabold ${estComplet ? 'text-red-600' : 'opacity-100'}`}>
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