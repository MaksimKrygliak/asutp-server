import * as admin from 'firebase-admin';
import serviceAccount from '../path/to/your/serviceAccountKey.json' assert { type: "json" };

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

export const firebaseAdmin = admin;