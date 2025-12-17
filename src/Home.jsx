import React from 'react';
import { Link } from 'react-router-dom';

export default function Home() {
    return (
        <div className="min-h-screen bg-stone-50 flex flex-col font-sans text-gray-800">
            {/* Navigation simple */}
            <nav className="p-6 flex justify-between items-center max-w-6xl mx-auto w-full">
                <div className="text-2xl font-bold font-playfair text-teal-800">Yoga Sandrine 🧘‍♀️</div>
                <Link to="/admin" className="text-sm font-bold text-gray-400 hover:text-teal-600 transition">Espace Prof</Link>
            </nav>

            {/* Hero Section */}
            <main className="flex-1 flex flex-col items-center justify-center p-6 text-center">
                <div className="max-w-2xl space-y-8 animate-in slide-in-from-bottom-10 duration-700">
                    <h1 className="text-5xl md:text-7xl font-playfair font-bold text-teal-900 leading-tight">
                        Respirez.<br />Pratiquez.<br />Évoluez.
                    </h1>
                    <p className="text-lg md:text-xl text-gray-600 font-light">
                        Gérez vos réservations de cours de Yoga en toute simplicité.
                        Retrouvez votre planning, vos crédits et votre progression.
                    </p>

                    <div className="flex flex-col md:flex-row gap-4 justify-center pt-8">
                        <Link to="/portal" className="px-8 py-4 bg-teal-700 text-white text-lg font-bold rounded-full shadow-xl hover:bg-teal-800 hover:scale-105 transition transform">
                            Accéder à mon Espace Élève
                        </Link>
                    </div>

                    <div className="pt-12 grid grid-cols-3 gap-8 text-center opacity-60">
                        <div>
                            <span className="block text-2xl font-bold text-teal-600">Hatha</span>
                            <span className="text-xs uppercase tracking-widest">Yoga</span>
                        </div>
                        <div>
                            <span className="block text-2xl font-bold text-teal-600">Vinyasa</span>
                            <span className="text-xs uppercase tracking-widest">Flow</span>
                        </div>
                        <div>
                            <span className="block text-2xl font-bold text-teal-600">Yin</span>
                            <span className="text-xs uppercase tracking-widest">Détente</span>
                        </div>
                    </div>
                </div>
            </main>

            <footer className="p-6 text-center text-gray-400 text-sm">
                &copy; {new Date().getFullYear()} Yoga Sandrine. Tous droits réservés.
            </footer>
        </div>
    );
}