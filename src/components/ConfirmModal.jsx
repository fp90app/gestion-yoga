import React from 'react';

export default function ConfirmModal({ isOpen, title, children, confirmLabel = "Confirmer", cancelLabel = "Annuler", colorClass = "bg-teal-600", onConfirm, onCancel }) {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-[2px]" onClick={onCancel}>
            <div className="bg-white p-6 rounded-2xl shadow-2xl w-80 animate-in fade-in zoom-in-95" onClick={e => e.stopPropagation()}>
                <h3 className="text-xl font-playfair font-bold text-gray-800 mb-4">{title}</h3>
                <div className="mb-6">
                    {children}
                </div>
                <div className="flex gap-3">
                    <button onClick={onCancel} className="flex-1 py-2 rounded-lg font-bold text-gray-500 bg-gray-100 hover:bg-gray-200 transition">
                        {cancelLabel}
                    </button>
                    <button onClick={onConfirm} className={`flex-1 py-2 rounded-lg font-bold text-white shadow-md ${colorClass} hover:opacity-90 transition`}>
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}