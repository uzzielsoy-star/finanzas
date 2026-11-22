// ============================================================
//  CONFIGURACIÓN — es el único archivo que tienes que editar
// ============================================================

// 1) Pega aquí la configuración de tu app web de Firebase
//    (Consola de Firebase › ⚙️ Configuración del proyecto › Tus apps › Web).
//    Mientras diga "TU_API_KEY", la app corre en MODO DEMO (datos solo en el navegador).
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDc33O9LV1aNgszX1Z3d5_v0VMWkVlNWbA",
  authDomain: "finanzas-matrimonio.firebaseapp.com",
  projectId: "finanzas-matrimonio",
  storageBucket: "finanzas-matrimonio.firebasestorage.app",
  messagingSenderId: "1009071628751",
  appId: "1:1009071628751:web:54b65ecbc0ba5c78b1f2ba",
};

// 2) Quién puede entrar lo deciden las REGLAS de Firestore (consola de Firebase › Firestore › Reglas).
//    Para dar acceso a alguien más solo editas las reglas allá; no hace falta tocar este archivo.
export const ALLOWED_EMAILS = [];

// 3) Nombre que aparece en la app
export const APP_NAME = "Finanzas Matrimonio";
