import React from 'react';
import { Link } from 'react-router-dom';

export default function Home() {
    return (
        <div className="min-h-screen bg-stone-50 font-sans text-gray-800">

            {/* --- HERO SECTION (En-tête) --- */}
            <header className="bg-white shadow-sm border-b border-stone-100">
                <div className="max-w-5xl mx-auto px-4 py-6 md:py-8 flex flex-col md:flex-row items-center justify-between gap-6">
                    <div className="flex items-center gap-4">
                        {/* LOGO */}
                        <img src="/logo.jpg" alt="Logo Natur'Veda" className="w-20 h-20 md:w-24 md:h-24 object-contain rounded-full border-2 border-teal-50 shadow-sm" />
                        <div>
                            <h1 className="text-3xl md:text-4xl font-playfair font-bold text-teal-900 leading-tight">
                                Natur’Veda
                            </h1>
                            <p className="text-amber-700 font-medium tracking-widest text-sm uppercase mt-1">Yoga • Méditation • Ayurvéda</p>
                        </div>
                    </div>
                    <div className="text-center md:text-right">
                        <p className="text-xl md:text-2xl font-playfair italic text-gray-600">"Respirez. Pratiquez. Évoluez."</p>
                    </div>
                </div>
            </header>

            {/* --- SECTION ACCÈS APPLICATION --- */}
            <section className="pt-8 px-4">
                <div className="max-w-4xl mx-auto bg-white rounded-2xl shadow-lg overflow-hidden border border-teal-100">
                    <div className="bg-teal-50 p-6 text-center border-b border-teal-100">
                        <h2 className="text-2xl font-bold text-teal-900 font-playfair mb-3">Espace Membre</h2>
                        <div className="text-teal-800 text-sm md:text-base max-w-2xl mx-auto font-medium space-y-2">
                            <p>
                                Vos cours de Yoga, simplifiés. Consultez votre planning, vos crédits et votre progression.
                            </p>
                            <p>
                                <span className="font-bold">Cours complet ?</span> Mettez-vous en attente pour recevoir une alerte en cas de désistement.
                            </p>
                        </div>
                    </div>

                    <div className="p-6 md:p-8 flex flex-col md:flex-row justify-center items-center gap-4 md:gap-6 bg-white">
                        {/* Bouton Élève : Ton adouci (Amber-600 au lieu de 700) */}
                        <Link to="/student" className="w-full md:w-auto px-8 py-3 bg-[#c27a4e] hover:bg-[#a8653e] text-white rounded-xl font-bold text-lg shadow-md hover:shadow-lg transition transform hover:-translate-y-0.5 text-center flex items-center justify-center gap-2">
                            🧘‍♀️ Accès Élève
                        </Link>
                        {/* Bouton Prof */}
                        <Link to="/admin" className="w-full md:w-auto px-8 py-3 bg-white border-2 border-teal-800 text-teal-900 hover:bg-teal-50 rounded-xl font-bold text-lg shadow-sm hover:shadow-md transition text-center flex items-center justify-center gap-2">
                            🔒 Accès Professeur
                        </Link>
                    </div>
                </div>
            </section>

            {/* --- NOUVELLE SECTION : AUDIO / MÉDITATION --- */}
            <section className="py-8 px-4">
                <div className="max-w-4xl mx-auto bg-white rounded-2xl shadow-lg border-l-8 border-amber-400 overflow-hidden flex flex-col md:flex-row items-center p-6 gap-6 hover:shadow-xl transition-shadow">

                    {/* Icône Casque + Lotus */}
                    <div className="shrink-0 text-amber-600">
                        <svg width="80" height="80" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                            {/* Arceau du casque */}
                            <path d="M20 50V40C20 23.4315 33.4315 10 50 10C66.5685 10 80 23.4315 80 40V50" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                            {/* Écouteurs */}
                            <rect x="10" y="50" width="20" height="30" rx="5" fill="currentColor" opacity="0.1" stroke="currentColor" strokeWidth="3" />
                            <rect x="70" y="50" width="20" height="30" rx="5" fill="currentColor" opacity="0.1" stroke="currentColor" strokeWidth="3" />
                            {/* Lotus stylisé sur l'arceau */}
                            <path d="M50 10C50 10 45 20 35 20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                            <path d="M50 10C50 10 55 20 65 20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                            <circle cx="50" cy="10" r="4" fill="currentColor" />
                            {/* Petite lune */}
                            <path d="M50 25C47 25 45 23 45 23C45 26 47 28 50 28C53 28 55 26 55 23C55 23 53 25 50 25Z" fill="currentColor" />
                        </svg>
                    </div>

                    <div className="text-center md:text-left flex-1">

                        <p className="text-gray-600 my-2 text-sm md:text-base leading-relaxed">
                            Vous pensez ne pas savoir méditer ? Découvrez la porte d'entrée la plus accessible vers l'état méditatif.
                        </p>
                        <a
                            href="https://www.ayurvedayoganidra.com/category/4-packs"
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 mt-2 text-amber-700 font-bold hover:text-amber-800 hover:underline uppercase tracking-wide text-sm"
                        >
                            Découvrir mes audios
                            <span className="text-lg">➜</span>
                        </a>
                    </div>
                </div>
            </section>

            {/* --- SECTION PRÉSENTATION PROFESSEUR --- */}
            <section className="pb-12 px-4 max-w-5xl mx-auto">
                <div className="grid md:grid-cols-12 gap-8 items-start">

                    {/* Colonne Gauche : Enseignements */}
                    <div className="md:col-span-8 space-y-8">
                        <div>
                            <h3 className="text-2xl font-playfair font-bold text-teal-800 mb-6 mt-0 border-b-2 border-amber-200 inline-block pb-1">
                                Enseignements & Pratiques
                            </h3>

                            <div className="grid md:grid-cols-2 gap-6">
                                <div className="bg-white p-5 rounded-lg shadow-sm border-l-4 border-teal-600">
                                    <h4 className="font-bold text-lg mb-3 text-teal-900">Professeur de Yoga</h4>
                                    <ul className="space-y-1 text-gray-600 text-sm md:text-base">
                                        <li>• HATHA Yoga</li>
                                        <li>• Yoga IYENGAR</li>
                                        <li>• YIN Yoga</li>
                                        <li>• GREEN Yoga</li>
                                        <li>• VINYASA Yoga</li>
                                        <li>• Mantra Yoga</li>
                                    </ul>
                                </div>

                                <div className="bg-white p-5 rounded-lg shadow-sm border-l-4 border-amber-600">
                                    <h4 className="font-bold text-lg mb-3 text-amber-900">Approfondissement</h4>
                                    <ul className="space-y-1 text-gray-600 text-sm md:text-base">
                                        <li>• Pranayama (Respiration)</li>
                                        <li>• Méditation</li>
                                        <li>• <strong>Yoga Nidra</strong> (Professeur & Instructeur)</li>
                                    </ul>
                                </div>
                            </div>
                        </div>

                        <div className="grid md:grid-cols-2 gap-6">
                            <div>
                                <h4 className="font-bold text-teal-800 mb-3 uppercase tracking-wide text-xs">Thérapies & Soins</h4>
                                <ul className="bg-teal-50 p-4 rounded-lg text-teal-900 space-y-2 font-medium text-sm">
                                    <li>🌿 Thérapeute en Ayurveda</li>
                                    <li>🌸 Praticienne en Aromathérapie</li>
                                </ul>
                            </div>
                            <div>
                                <h4 className="font-bold text-amber-800 mb-3 uppercase tracking-wide text-xs">Textes Anciens & Sacrés</h4>
                                <ul className="bg-amber-50 p-4 rounded-lg text-amber-900 space-y-2 font-medium text-sm">
                                    <li>📜 Sanātana Dharma</li>
                                    <li>📜 Yoga Sutra</li>
                                    <li>📜 Bhagavad Gīta</li>
                                </ul>
                            </div>
                        </div>
                    </div>

                    {/* Colonne Droite : Carte de visite / Contact */}
                    <div className="md:col-span-4 bg-white p-6 rounded-xl shadow-lg border border-stone-200 sticky top-4">
                        <div className="text-center mb-6">
                            <div className="w-16 h-1 bg-amber-600 mx-auto mb-4 rounded-full"></div>
                            <h3 className="text-xl font-bold text-gray-800">Sandrine PUTOD</h3>
                            <p className="text-teal-700 italic text-sm">Fondatrice Natur'Veda</p>
                        </div>

                        <div className="space-y-4 text-sm text-gray-600">
                            <div className="flex items-start gap-3">
                                <span className="text-xl">📍</span>
                                <p>
                                    <strong>8, rue des frênes</strong><br />
                                    (entrée par le portail blanc)<br />
                                    39250 MIGNOVILLARD
                                </p>
                            </div>

                            <div className="flex items-center gap-3">
                                <span className="text-xl">📞</span>
                                <a href="tel:0781108075" className="font-bold text-gray-800 hover:text-amber-700 transition">07 81 10 80 75</a>
                            </div>

                            <div className="flex items-center gap-3">
                                <span className="text-xl">📧</span>
                                <a href="mailto:putod.sandrine@gmail.com" className="hover:text-amber-700 transition truncate">putod.sandrine@gmail.com</a>
                            </div>

                            <div className="flex items-center gap-3">
                                <span className="text-xl">🌐</span>
                                <a href="https://www.ayurvedayoganidra.com" target="_blank" rel="noreferrer" className="text-teal-700 font-medium hover:underline hover:text-teal-900">
                                    www.ayurvedayoganidra.com
                                </a>
                            </div>
                        </div>

                        <div className="mt-6 pt-6 border-t border-gray-100 flex justify-center gap-4">
                            <a href="https://www.facebook.com/AYURVEDAYOGANIDRA" target="_blank" rel="noreferrer" className="bg-[#1877F2] text-white p-2.5 rounded-full hover:bg-blue-700 transition flex items-center justify-center shadow-sm" title="Facebook">
                                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                                    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                                </svg>
                            </a>
                            <a href="https://www.instagram.com/naturveda.yoganidra/?hl=fr" target="_blank" rel="noreferrer" className="bg-[#E4405F] text-white p-2.5 rounded-full hover:bg-pink-700 transition flex items-center justify-center shadow-sm" title="Instagram">
                                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                                    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.85s-.012 3.584-.07 4.85c-.148 3.252-1.691 4.771-4.919 4.919-1.265.058-1.645.069-4.85.069s-3.584-.012-4.85-.07c-3.252-.148-4.771-1.691-4.919-4.919-.058-1.265-.069-1.645-.069-4.85s.012-3.584.07-4.85c.148-3.252 1.691-4.771 4.919-4.919 1.265-.058 1.645-.069 4.85-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
                                </svg>
                            </a>
                        </div>
                    </div>

                </div>
            </section>

            {/* --- FOOTER --- */}
            <footer className="bg-stone-800 text-stone-400 py-8 text-center text-sm">
                <p>&copy; {new Date().getFullYear()} Natur'Veda - Sandrine Putod.</p>
                <p className="mt-2 text-xs opacity-50">Respirez. Pratiquez. Évoluez.</p>
            </footer>
        </div>
    );
}