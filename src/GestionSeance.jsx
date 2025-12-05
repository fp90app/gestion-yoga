import { useState, useEffect } from 'react';
import { db } from './firebase';
import {
    collection,
    getDocs,
    doc,
    getDoc,
    writeBatch,
    increment,
    deleteDoc,
    setDoc,
    serverTimestamp,
    Timestamp,
    deleteField
} from 'firebase/firestore';

export default function GestionSeance({ groupe, date, onClose, onEdit }) {
    const [inscrits, setInscrits] = useState([]);
    const [invites, setInvites] = useState([]);
    const [waitingList, setWaitingList] = useState([]); // <--- NOUVEAU STATE
    const [allStudents, setAllStudents] = useState([]);

    const [statuses, setStatuses] = useState({});
    const [initialStatus, setInitialStatus] = useState({});

    const [loading, setLoading] = useState(true);
    const [estAnnule, setEstAnnule] = useState(false);
    const [selectedGuestId, setSelectedGuestId] = useState("");

    // IDs
    const dateStr = date.toLocaleDateString('fr-CA');
    const seanceId = `${dateStr}_${groupe.id}`;
    const exceptionId = `${dateStr}_${groupe.id}_CANCEL`;

    useEffect(() => {
        chargerDonnees();
    }, []);

    // --- HELPER DATES ---
    const isExpired = (timestamp) => {
        if (!timestamp || !timestamp.toDate) return true;
        return timestamp.toDate() < new Date();
    };

    const chargerDonnees = async () => {
        try {
            // 1. Vérif Annulation
            if (groupe.type === 'standard') {
                const exceptionDoc = await getDoc(doc(db, "exceptions", exceptionId));
                setEstAnnule(exceptionDoc.exists());
            }

            // 2. Charger TOUS les élèves
            const elevesSnapshot = await getDocs(collection(db, "eleves"));
            const tous = elevesSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            tous.sort((a, b) => a.nom.localeCompare(b.nom));
            setAllStudents(tous);

            // 3. Charger l'historique de la séance
            const attendanceDoc = await getDoc(doc(db, "attendance", seanceId));
            let savedStatus = {};
            let savedGuestIds = [];
            let savedWaitingIds = []; // <--- Récup des IDs en attente

            if (attendanceDoc.exists()) {
                const data = attendanceDoc.data();
                savedStatus = data.status || {};
                savedWaitingIds = data.waitingList || []; // <--- Lecture du champ

                // On filtre les invités (ceux qui sont dans status mais pas inscrits au groupe)
                savedGuestIds = Object.keys(savedStatus).filter(id => {
                    const student = tous.find(s => s.id === id);
                    return student && (!student.enrolledGroupIds || !student.enrolledGroupIds.includes(groupe.id));
                });
            }

            // 4. Séparer Inscrits vs Invités vs File d'attente
            const listeInscrits = tous.filter(e => e.enrolledGroupIds && e.enrolledGroupIds.includes(groupe.id));
            const listeInvites = savedGuestIds.map(id => tous.find(s => s.id === id)).filter(Boolean);

            // Mapper les IDs de la file d'attente vers les objets élèves complets
            const listeAttente = savedWaitingIds.map(id => tous.find(s => s.id === id)).filter(Boolean);

            setInscrits(listeInscrits);
            setInvites(listeInvites);
            setWaitingList(listeAttente); // <--- Mise à jour du state

            // 5. Initialiser les statuts
            const finalStatus = { ...savedStatus };

            listeInscrits.forEach(e => {
                if (!finalStatus[e.id]) finalStatus[e.id] = 'present';
            });

            listeInvites.forEach(e => {
                if (!finalStatus[e.id]) finalStatus[e.id] = 'present';
            });

            setStatuses(finalStatus);
            setInitialStatus(JSON.parse(JSON.stringify(finalStatus)));

        } catch (error) {
            console.error("Erreur chargement:", error);
        } finally {
            setLoading(false);
        }
    };

    const toggleStatus = (eleveId) => {
        setStatuses(prev => ({
            ...prev,
            [eleveId]: prev[eleveId] === 'present' ? 'absent' : 'present'
        }));
    };

    const ajouterInvite = () => {
        if (!selectedGuestId) return;
        if (inscrits.find(e => e.id === selectedGuestId) || invites.find(e => e.id === selectedGuestId)) {
            alert("Cet élève est déjà dans la liste !");
            return;
        }
        const eleve = allStudents.find(e => e.id === selectedGuestId);
        if (eleve) {
            setInvites(prev => [...prev, eleve]);
            setStatuses(prev => ({ ...prev, [eleve.id]: 'present' }));
            setSelectedGuestId("");
        }
    };

    const retirerInvite = (eleveId) => {
        if (confirm("Retirer cet invité de la liste ?")) {
            // 1. Retirer de la liste visuelle
            setInvites(prev => prev.filter(e => e.id !== eleveId));

            // 2. Retirer de l'objet des statuts (CRUCIAL pour que ça ne compte plus comme Présent)
            const newStatuses = { ...statuses };
            delete newStatuses[eleveId];
            setStatuses(newStatuses);

            // 3. (Optionnel) Si vous voulez qu'il retourne dans la file d'attente :
            const eleve = allStudents.find(e => e.id === eleveId);
            if (eleve) setWaitingList(prev => [...prev, eleve]);
        }
    };

    // --- FONCTION POUR BASCULER DEPUIS LA LISTE D'ATTENTE ---
    const basculerWaitingToInscrit = (eleveId) => {
        if (!confirm("Inscrire cet élève (débitera 1 crédit ou comptera comme rattrapage) ?")) return;

        const eleve = allStudents.find(e => e.id === eleveId);
        if (!eleve) return;

        // 1. Le retirer de la liste d'attente visuelle
        setWaitingList(prev => prev.filter(e => e.id !== eleveId));

        // 2. L'ajouter aux invités
        setInvites(prev => [...prev, eleve]);

        // 3. Le marquer présent
        setStatuses(prev => ({ ...prev, [eleve.id]: 'present' }));
    };

    const sauvegarder = async () => {
        setLoading(true);
        try {
            const batch = writeBatch(db);
            const attendanceRef = doc(db, "attendance", seanceId);

            // 1. Préparation de l'objet de status pour la sauvegarde
            // On prend le status actuel (UI)
            const statusToSave = { ...statuses };

            // MAGIC FIX : On cherche les IDs qui ont été supprimés (présents dans initialStatus mais absents de statuses)
            // Et on leur assigne deleteField() pour que Firestore les efface vraiment.
            Object.keys(initialStatus).forEach(id => {
                if (statuses[id] === undefined) {
                    statusToSave[id] = deleteField();
                }
            });

            // 2. Sauvegarde principale
            // Note : Pas besoin de merge: true sur statusToSave car on a calculé toutes les clés
            // MAIS on garde merge: true global pour ne pas écraser d'autres champs potentiels du document
            batch.set(attendanceRef, {
                date: dateStr,
                groupeId: groupe.id,
                nomGroupe: groupe.nom,
                realDate: Timestamp.fromDate(date),
                status: statusToSave, // <--- L'objet contient les valeurs 'present', 'absent' ET deleteField()
                waitingList: waitingList.map(e => e.id),
                updatedAt: serverTimestamp()
            }, { merge: true });

            // 3. Calcul Crédits (Logique inchangée mais fiable)
            const allInvolvedIds = new Set([
                ...Object.keys(initialStatus),
                ...Object.keys(statuses)
            ]);

            allInvolvedIds.forEach(eleveId => {
                const oldVal = initialStatus[eleveId];
                const newVal = statuses[eleveId]; // undefined si supprimé

                // Normalisation : si undefined, on considère 'removed' pour la logique
                const effectiveNewVal = newVal || 'removed';

                if (oldVal === effectiveNewVal) return;

                const estInscrit = inscrits.some(e => e.id === eleveId); // Utilisation de la liste calculée
                let creditChange = 0;

                if (estInscrit) {
                    // Logique inscrit
                    if (effectiveNewVal === 'absent' && oldVal !== 'absent') creditChange = 1;
                    else if (effectiveNewVal === 'present' && oldVal === 'absent') creditChange = -1;
                } else {
                    // Logique invité
                    // Si on ajoute un invité (old!=present, new=present) -> -1 crédit
                    if (effectiveNewVal === 'present' && oldVal !== 'present') creditChange = -1;
                    // Si on retire un invité ou on le met absent (old=present, new!=present) -> +1 crédit (remboursement)
                    else if (effectiveNewVal !== 'present' && oldVal === 'present') creditChange = 1;
                }

                if (creditChange !== 0) {
                    const eleveRef = doc(db, "eleves", eleveId);
                    batch.update(eleveRef, { absARemplacer: increment(creditChange) });
                }
            });

            await batch.commit();
            alert("Modifications enregistrées ! ✅");
            onClose();

        } catch (error) {
            console.error("Erreur sauvegarde:", error);
            alert("Erreur : " + error.message);
        } finally {
            setLoading(false);
        }
    };
    const handleCancelOrDelete = async () => {
        if (groupe.type === 'ajout') {
            if (confirm("Voulez-vous SUPPRIMER définitivement cette séance ?")) {
                await deleteDoc(doc(db, "exceptions", groupe.originalExceptionId));
                onClose();
            }
        } else {
            if (confirm(`Voulez-vous vraiment ANNULER le cours du ${date.toLocaleDateString()} ?`)) {
                await setDoc(doc(db, "exceptions", exceptionId), { date: dateStr, groupeId: groupe.id, type: "annulation" });
                onClose();
            }
        }
    };

    const retablirLeCours = async () => {
        if (confirm(`Voulez-vous RÉTABLIR ce cours ?`)) {
            await deleteDoc(doc(db, "exceptions", exceptionId));
            onClose();
        }
    };

    if (loading) return <div className="fixed inset-0 bg-black/80 flex text-white items-center justify-center z-50">Chargement...</div>;

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">

                {/* Header */}
                <div className={`p-6 text-white flex justify-between items-start ${estAnnule ? 'bg-gray-600' : (groupe.type === 'ajout' ? 'bg-purple-700' : 'bg-teal-700')}`}>
                    <div>
                        <h2 className="text-2xl font-bold font-playfair">
                            {groupe.nom}
                            {estAnnule && <span className="ml-3 text-sm bg-red-500 text-white px-2 py-1 rounded uppercase">Annulé</span>}
                            {groupe.type === 'ajout' && <span className="ml-3 text-sm bg-purple-900 text-white px-2 py-1 rounded uppercase">Ponctuel</span>}
                        </h2>
                        <p className="text-teal-100 mt-1">
                            Séance du {date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="bg-white/20 hover:bg-white/40 text-white rounded-full w-10 h-10 flex items-center justify-center transition font-bold text-xl backdrop-blur-sm"
                    >
                        ✕
                    </button>
                </div>

                {/* Contenu */}
                <div className="flex-1 overflow-y-auto p-6 bg-gray-50">
                    {estAnnule ? (
                        <div className="flex flex-col items-center justify-center h-full text-gray-500">
                            <div className="text-4xl mb-4">🚫</div>
                            <p className="text-lg">Ce cours est annulé.</p>
                        </div>
                    ) : (
                        <>
                            {/* --- LISTE DES INSCRITS (Standards) --- */}
                            <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">Inscrits à l'année ({inscrits.length})</h3>
                            {inscrits.length === 0 && <p className="text-gray-400 italic text-sm mb-6">Aucun inscrit régulier.</p>}

                            <div className="space-y-3 mb-8">
                                {inscrits.map(eleve => {
                                    const isPresent = statuses[eleve.id] === 'present';
                                    const expired = isExpired(eleve.finAbonnement);

                                    return (
                                        <div key={eleve.id} onClick={() => toggleStatus(eleve.id)} className={`flex items-center justify-between p-3 rounded-xl border-2 cursor-pointer transition-all ${isPresent ? 'bg-white border-transparent shadow-sm' : 'bg-red-50 border-red-200'}`}>
                                            <div className="flex items-center gap-3">
                                                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm shadow-sm ${isPresent ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>{isPresent ? '👋' : '🚫'}</div>
                                                <div className="flex flex-col">
                                                    <span className={`font-bold ${isPresent ? 'text-gray-800' : 'text-red-800'}`}>
                                                        {eleve.nom} {eleve.prenom}
                                                    </span>
                                                    {expired && (
                                                        <span className="text-[10px] text-red-600 font-bold bg-red-100 px-1 rounded border border-red-200 inline-block w-max mt-0.5">
                                                            ⚠️ Abo. Expiré
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <span className={`text-xs font-bold uppercase px-2 py-1 rounded ${isPresent ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{isPresent ? 'Présent' : 'Absent'}</span>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* --- LISTE DES INVITÉS / RATTRAPAGES --- */}
                            <div className="border-t border-gray-200 pt-6">
                                <h3 className="text-sm font-bold text-purple-600 uppercase tracking-wider mb-3 flex justify-between">
                                    Invités / Rattrapages ({invites.length})
                                </h3>

                                <div className="space-y-3 mb-6">
                                    {invites.map(eleve => {
                                        const expired = isExpired(eleve.finAbonnement);
                                        return (
                                            <div key={eleve.id} className="flex items-center justify-between p-3 rounded-xl border-2 border-purple-100 bg-purple-50">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm bg-purple-200 text-purple-700">➕</div>
                                                    <div>
                                                        <span className="font-bold text-gray-800 block">{eleve.nom} {eleve.prenom}</span>
                                                        <div className="flex gap-2">
                                                            <span className="text-[10px] text-purple-600 font-semibold">
                                                                Solde: {eleve.absARemplacer || 0}
                                                            </span>
                                                            {expired && <span className="text-[10px] text-red-500 font-semibold">⚠️ Expiré</span>}
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        onClick={() => toggleStatus(eleve.id)}
                                                        className={`text-xs font-bold uppercase px-2 py-1 rounded mr-2 ${statuses[eleve.id] === 'present' ? 'bg-purple-200 text-purple-800' : 'bg-red-200 text-red-800'}`}
                                                    >
                                                        {statuses[eleve.id] === 'present' ? 'Présent' : 'Absent'}
                                                    </button>

                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); retirerInvite(eleve.id); }}
                                                        className="w-6 h-6 flex items-center justify-center bg-white text-red-500 rounded-full hover:bg-red-100 border border-red-100"
                                                        title="Retirer"
                                                    >
                                                        ✕
                                                    </button>
                                                </div>
                                            </div>
                                        )
                                    })}
                                    {invites.length === 0 && <p className="text-gray-400 italic text-sm">Aucun invité pour cette séance.</p>}
                                </div>

                                {/* --- ZONE D'AJOUT INVITE --- */}
                                <div className="flex gap-2 bg-gray-100 p-2 rounded-lg">
                                    <select
                                        className="flex-1 border-none bg-transparent text-sm focus:ring-0 outline-none cursor-pointer"
                                        value={selectedGuestId}
                                        onChange={(e) => setSelectedGuestId(e.target.value)}
                                    >
                                        <option value="">-- Ajouter un élève (Rattrapage) --</option>
                                        {allStudents
                                            .filter(s => !inscrits.find(i => i.id === s.id) && !invites.find(i => i.id === s.id))
                                            .map(s => {
                                                const expired = isExpired(s.finAbonnement);
                                                return (
                                                    <option key={s.id} value={s.id}>
                                                        {s.nom} {s.prenom} • {s.absARemplacer} crédits {expired ? "(⚠️ Expiré)" : ""}
                                                    </option>
                                                );
                                            })}
                                    </select>
                                    <button
                                        onClick={ajouterInvite}
                                        disabled={!selectedGuestId}
                                        className="bg-purple-600 text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                                    >
                                        Ajouter
                                    </button>
                                </div>
                            </div>

                            {/* --- FILE D'ATTENTE --- */}
                            {waitingList.length > 0 && (
                                <div className="border-t border-gray-200 pt-6 mt-6 bg-orange-50 p-4 rounded-xl border border-orange-100">
                                    <h3 className="text-sm font-bold text-orange-700 uppercase tracking-wider mb-3 flex items-center gap-2">
                                        🕒 File d'attente ({waitingList.length})
                                    </h3>
                                    <p className="text-xs text-orange-600 mb-3 italic">
                                        Ces élèves recevront un email si une place se libère. Vous pouvez aussi les inscrire manuellement.
                                    </p>
                                    <div className="space-y-2">
                                        {waitingList.map(eleve => (
                                            <div key={eleve.id} className="flex justify-between items-center bg-white p-3 rounded-lg border border-orange-100 shadow-sm">
                                                <div>
                                                    <span className="text-gray-800 font-bold text-sm block">{eleve.nom} {eleve.prenom}</span>
                                                    <span className="text-xs text-gray-500">Solde: {eleve.absARemplacer}</span>
                                                </div>
                                                <button
                                                    onClick={() => basculerWaitingToInscrit(eleve.id)}
                                                    className="text-xs bg-green-100 text-green-700 font-bold px-3 py-2 rounded-lg hover:bg-green-200 border border-green-200 shadow-sm transition"
                                                >
                                                    + Inscrire
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 bg-white border-t flex justify-between items-center z-10">

                    {/* ZONE GAUCHE : Actions (Modifier, Annuler, Rétablir) */}
                    <div className="flex items-center gap-2">
                        {estAnnule ? (
                            <button onClick={retablirLeCours} className="text-teal-600 font-bold text-sm underline px-2">
                                ↩ Rétablir
                            </button>
                        ) : (
                            <>
                                {/* BOUTON MODIFIER (Uniquement pour les ajouts) */}
                                {groupe.type === 'ajout' && (
                                    <button
                                        onClick={() => onEdit(groupe)}
                                        className="text-blue-600 font-bold text-sm underline px-2 hover:text-blue-800"
                                    >
                                        ✏️ Modifier
                                    </button>
                                )}

                                <button onClick={handleCancelOrDelete} className="text-red-400 hover:text-red-600 font-bold text-xs underline px-2">
                                    {groupe.type === 'ajout' ? 'Supprimer' : 'Annuler ce cours'}
                                </button>
                            </>
                        )}
                    </div>

                    {/* ZONE DROITE : Fermer / Valider */}
                    <div className="flex gap-3 w-full md:w-auto justify-end">
                        <button onClick={onClose} className="px-4 py-2 rounded-lg font-bold text-gray-500 border hover:bg-gray-50">
                            Fermer
                        </button>
                        {!estAnnule && (
                            <button onClick={sauvegarder} className="bg-green-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-green-700 shadow-lg w-full md:w-auto">
                                Valider l'appel ✅
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}