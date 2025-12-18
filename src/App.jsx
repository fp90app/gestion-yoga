import { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from './firebase';
import { Toaster } from 'react-hot-toast';

import Planning from './Planning';
import Annuaire from './annuaire.jsx';
import Login from './Login';
import StudentPortal from './StudentPortal';
import Home from './Home';

// --- COMPOSANT WRAPPER POUR PROTÉGER LA ROUTE ADMIN ---
const AdminRoute = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  if (loading) return <div className="p-10 text-center">Chargement Admin...</div>;

  // Si pas connecté, on redirige vers le Login
  if (!user) return <Login />;

  // Si connecté, on affiche l'app Admin
  return children;
};


// --- APP PRINCIPALE AVEC ROUTING ---
function App() {
  return (
    <>
      {/* Configuration globale des notifications (Toasts) */}
      <Toaster
        position="top-center"
        toastOptions={{
          duration: 3000,
          style: { background: '#333', color: '#fff' }
        }}
      />

      <Routes>
        {/* Route 1 : Page d'Accueil Publique */}
        <Route path="/" element={<Home />} />

        {/* Route 2 : Le Portail Élève (Renommé en /student pour correspondre au bouton de l'accueil) */}
        <Route path="/student" element={<StudentPortal />} />

        {/* Route 3 : Admin Sécurisée */}
        <Route path="/admin" element={
          <AdminRoute>
            <AdminDashboard />
          </AdminRoute>
        } />

        {/* Sécurité : Redirection vers l'accueil si l'URL est inconnue */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

// --- DASHBOARD ADMIN ---
function AdminDashboard() {
  const [ongletActif, setOngletActif] = useState('planning');

  const handleLogout = async () => {
    await signOut(auth);
    window.location.href = "/"; // Force reload vers l'accueil
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <span className="text-xl font-bold text-teal-700 font-playfair mr-8 hidden md:block">
                Yoga Admin 🧘‍♀️
              </span>
              <div className="flex space-x-2 md:space-x-4">
                <button onClick={() => setOngletActif('planning')} className={`px-3 py-2 rounded-md text-sm font-medium transition ${ongletActif === 'planning' ? 'bg-teal-50 text-teal-700' : 'text-gray-500 hover:text-gray-700'}`}>📅 Planning</button>
                <button onClick={() => setOngletActif('Annuaire')} className={`px-3 py-2 rounded-md text-sm font-medium transition ${ongletActif === 'Annuaire' ? 'bg-teal-50 text-teal-700' : 'text-gray-500 hover:text-gray-700'}`}>👥 Élèves</button>
              </div>
            </div>
            <div className="flex items-center">
              <button onClick={handleLogout} className="text-gray-400 hover:text-red-500 transition text-sm font-bold border border-gray-200 px-3 py-1 rounded hover:bg-red-50">Déconnexion</button>
            </div>
          </div>
        </div>
      </nav>
      <main className="py-8">
        {ongletActif === 'planning' && <Planning />}
        {ongletActif === 'Annuaire' && <Annuaire />}
      </main>
    </div>
  );
}

export default App;