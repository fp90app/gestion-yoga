import { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, query, orderBy, getDocs, limit } from 'firebase/firestore';

export default function HistoryModal({ student, onClose }) {
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchHistory = async () => {
            try {
                // On récupère les 20 derniers mouvements
                const q = query(
                    collection(db, "eleves", student.id, "history"),
                    orderBy("date", "desc"),
                    limit(20)
                );
                const snap = await getDocs(q);
                const historyData = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setHistory(historyData);
            } catch (err) {
                console.error("Erreur historique:", err);
            } finally {
                setLoading(false);
            }
        };

        fetchHistory();
    }, [student.id]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[80vh] m-4" onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div className="bg-teal-900 p-4 flex justify-between items-center text-white">
                    <h3 className="font-playfair font-bold text-lg">Historique des séances</h3>
                    <button onClick={onClose} className="hover:bg-white/20 rounded-full w-8 h-8 flex items-center justify-center">✕</button>
                </div>

                {/* Contenu */}
                <div className="flex-1 overflow-y-auto p-4 bg-gray-50">
                    {loading ? (
                        <div className="space-y-3">
                            {[1, 2, 3].map(i => <div key={i} className="h-16 bg-gray-200 rounded-lg animate-pulse"></div>)}
                        </div>
                    ) : history.length === 0 ? (
                        <div className="text-center py-10 text-gray-400 italic">
                            Aucun historique récent.
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {history.map(item => {
                                const isPositive = item.delta > 0;
                                const isNeutral = item.delta === 0;

                                return (
                                    <div key={item.id} className="bg-white p-3 rounded-lg shadow-sm border border-gray-100 flex justify-between items-center">
                                        <div>
                                            <div className="font-bold text-gray-800 text-sm">{item.motif}</div>
                                            <div className="text-xs text-gray-400 mt-1">
                                                {item.date?.toDate().toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                            </div>
                                        </div>
                                        <div className={`font-bold text-lg ${isNeutral ? 'text-gray-400' : (isPositive ? 'text-green-600' : 'text-red-500')}`}>
                                            {isPositive ? '+' : ''}{item.delta}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div className="p-4 bg-white border-t text-center text-xs text-gray-400">
                    Seuls les 20 derniers mouvements sont affichés.
                </div>
            </div>
        </div>
    );
}