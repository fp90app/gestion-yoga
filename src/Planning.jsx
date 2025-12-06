import { useState, useEffect } from 'react';
import { db } from './firebase';
import { collection, getDocs, query, where, doc, updateDoc } from 'firebase/firestore';
import GestionSeance from './GestionSeance';
import AjoutSeance from './AjoutSeance';
import GestionGroupes from './GestionGroupes';

const JOURS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
const MOIS = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc"];

// --- CONFIGURATION CALENDRIER ---
const HEURE_DEBUT = 8; // Le planning commence à 8h00
const HEURE_FIN = 21;  // Le planning finit à 21h00
const PIXELS_PAR_HEURE = 80; // Hauteur d'une heure (plus grand = plus aéré)

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

    // Modales
    const [seanceSelectionnee, setSeanceSelectionnee] = useState(null);
    const [showAjoutModal, setShowAjoutModal] = useState(false);
    const [showGestionGroupes, setShowGestionGroupes] = useState(false);
    const [exceptionAEditer, setExceptionAEditer] = useState(null);

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

        const getStatsSeance = (groupeId, dateStr, inscritsBase) => {
            const seanceId = `${dateStr}_${groupeId}`;
            const attendanceDoc = attendances.find(a => a.id === seanceId);
            let nbAbsents = 0, nbInvites = 0, waitingCount = 0;

            if (attendanceDoc) {
                const status = attendanceDoc.status || {};
                waitingCount = attendanceDoc.waitingList ? attendanceDoc.waitingList.length : 0;
                Object.entries(status).forEach(([uid, st]) => {
                    const eleve = eleves.find(e => e.id === uid);
                    if (!eleve) return;

                    const estInscrit = eleve.enrolledGroupIds && eleve.enrolledGroupIds.includes(groupeId);

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

        // 1. Récurrents
        groupes.forEach(groupe => {
            const dateDuCours = ajouterJours(lundiActuel, groupe.jour - 1);

            // =========================================================
            //  NOUVEAU : FILTRE TEMPOREL (SAISONNALITÉ)
            // =========================================================
            // On vérifie si ce cours est actif pour la date affichée
            if (groupe.dateDebut && groupe.dateFin) {
                // Gestion robuste : conversion Timestamp -> Date ou new Date() direct
                const debut = groupe.dateDebut.toDate ? groupe.dateDebut.toDate() : new Date(groupe.dateDebut);
                const fin = groupe.dateFin.toDate ? groupe.dateFin.toDate() : new Date(groupe.dateFin);

                // On normalise à minuit pour comparer juste les jours
                debut.setHours(0, 0, 0, 0);
                fin.setHours(23, 59, 59, 999); // Fin inclusif

                // Si la date du calendrier est HORS de la période du groupe, on ne l'affiche pas
                if (dateDuCours < debut || dateDuCours > fin) {
                    return; // On passe au groupe suivant
                }
            }
            // =========================================================

            const dateStr = dateDuCours.toLocaleDateString('fr-CA');
            const estAnnule = exceptions.some(ex => ex.groupeId === groupe.id && ex.date === dateStr && ex.type === "annulation");
            const inscritsCount = eleves.filter(e => e.enrolledGroupIds && e.enrolledGroupIds.includes(groupe.id)).length;
            const stats = getStatsSeance(groupe.id, dateStr, inscritsCount);

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

        // 2. Ajouts
        const dimancheFinStr = ajouterJours(lundiActuel, 6).toLocaleDateString('fr-CA');
        const lundiDebutStr = lundiActuel.toLocaleDateString('fr-CA');
        const ajoutsSemaine = exceptions.filter(ex => ex.type === "ajout" && ex.date >= lundiDebutStr && ex.date <= dimancheFinStr);

        ajoutsSemaine.forEach(ajout => {
            const [y, m, d] = ajout.date.split('-').map(Number);
            const dateReelle = new Date(y, m - 1, d);
            const stats = getStatsSeance(ajout.groupeId || 'ajout', ajout.date, 0);
            listeFinale.push({
                id: ajout.id, ...ajout.newSessionData,
                dateReelle, type: 'ajout', estAnnule: false,
                inscritsCount: 0, presentCount: stats.reel, waitingCount: stats.waitingCount, originalExceptionId: ajout.id
            });
        });

        listeFinale.sort((a, b) => a.dateReelle - b.dateReelle || a.heureDebut.localeCompare(b.heureDebut));
        setCoursAffiches(listeFinale);
    };

    useEffect(() => { if (!loading) calculerPlanningDeLaSemaine(); }, [lundiActuel, donneesBrutes, loading]);

    const changerSemaine = (offset) => setLundiActuel(prev => ajouterJours(prev, offset * 7));

    // --- LOGIQUE DE POSITIONNEMENT (CALENDRIER) ---
    const getCardStyle = (heureDebut, duree) => {
        const [h, m] = heureDebut.split(':').map(Number);
        const minutesDepuisDebut = (h - HEURE_DEBUT) * 60 + m;
        const top = (minutesDepuisDebut / 60) * PIXELS_PAR_HEURE;
        const height = (duree / 60) * PIXELS_PAR_HEURE;
        return { top: `${top}px`, height: `${height}px` };
    };

    if (loading) return <div className="flex justify-center items-center h-64 text-teal-600 font-bold">Chargement...</div>;
    const dimancheFinSemaine = ajouterJours(lundiActuel, 6);

    const calculerHeureFin = (heureDebut, dureeMinutes) => {
        const [h, m] = heureDebut.split(':').map(Number);
        const date = new Date();
        date.setHours(h, m, 0, 0);
        date.setMinutes(date.getMinutes() + dureeMinutes);
        return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', 'h');
    };

    return (
        <div className="max-w-7xl mx-auto p-2 md:p-6">

            {/* --- HEADER --- */}
            <div className="flex flex-col md:flex-row items-center justify-between mb-6 bg-white p-4 rounded-xl shadow-sm border border-gray-100 sticky top-0 z-20">
                <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-start">
                    <h2 className="text-xl md:text-2xl font-playfair font-bold text-gray-800 whitespace-nowrap">
                        {formaterDateSimple(lundiActuel)} - {formaterDateSimple(dimancheFinSemaine)}
                    </h2>

                    <div className="flex gap-2">
                        <button onClick={() => setShowGestionGroupes(true)} className="bg-white text-teal-700 border border-teal-200 p-2 rounded-lg hover:bg-teal-50" title="Gérer les cours">⚙️</button>
                        <button onClick={() => setShowAjoutModal(true)} className="bg-purple-700 text-white p-2 rounded-lg hover:bg-purple-800" title="Ajouter Séance">➕</button>
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

                    return (
                        <div key={groupe.id + groupe.dateReelle.toString()} className={`bg-white rounded-lg shadow border-l-4 p-4 flex justify-between items-center ${groupe.estAnnule ? 'border-red-400 opacity-75' : (estComplet ? 'border-red-500' : 'border-teal-500')}`}>
                            <div>
                                <div className="text-xs uppercase text-gray-400 font-bold mb-1">
                                    {JOURS[groupe.dateReelle.getDay()]} {groupe.dateReelle.getDate()} • {groupe.heureDebut}
                                </div>
                                <h3 className={`font-bold text-lg ${groupe.estAnnule ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                                    {groupe.nom}
                                </h3>
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

                                {/* Lignes repères */}
                                {Array.from({ length: HEURE_FIN - HEURE_DEBUT }).map((_, i) => (
                                    <div key={i} className="absolute w-full border-b border-gray-100" style={{ top: i * PIXELS_PAR_HEURE, height: PIXELS_PAR_HEURE }}></div>
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
                                            onClick={() => setSeanceSelectionnee({ groupe: groupe, date: groupe.dateReelle })}
                                            className={`absolute left-1 right-1 rounded-md p-2 border-l-4 cursor-pointer transition-all shadow-sm hover:shadow-md overflow-hidden flex flex-col justify-between ${containerClass}`}
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
                    onEdit={(groupe) => {
                        setSeanceSelectionnee(null);
                        setExceptionAEditer(groupe);
                        setShowAjoutModal(true);
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
            {showGestionGroupes && <GestionGroupes onClose={() => setShowGestionGroupes(false)} onUpdate={() => fetchDonnees()} />}
        </div>
    );
}