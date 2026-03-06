const admin = require('firebase-admin');

// Firebase is optional — only initialise if credentials are provided
const hasFirebaseConfig = process.env.FIREBASE_PROJECT_ID &&
  process.env.FIREBASE_PRIVATE_KEY &&
  process.env.FIREBASE_CLIENT_EMAIL;

if (hasFirebaseConfig && !admin.apps.length) {
  const serviceAccount = {
    projectId: process.env.FIREBASE_PROJECT_ID,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  };
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const auth = hasFirebaseConfig ? admin.auth() : null;

module.exports = { admin: hasFirebaseConfig ? admin : null, auth };