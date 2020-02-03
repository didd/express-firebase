const path = require("path");
const os = require("os");
const fs = require("fs");

const functions = require("firebase-functions");
const admin = require("firebase-admin");

const express = require("express");
const Busboy = require("busboy");

const serviceAccount = require("./service-account.json");

const cookieParser = require("cookie-parser")();
const cors = require("cors")({ origin: true });

const app = express();

const STORAGE_BUCKET = "";
const DATABASE_URL = "";

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: DATABASE_URL,
  storageBucket: STORAGE_BUCKET
});

const db = admin.firestore();
const bucket = admin.storage().bucket();

const validateFirebaseIdToken = async (req, res, next) => {
  if (
    (!req.headers.authorization ||
      !req.headers.authorization.startsWith("Bearer ")) &&
    !(req.cookies && req.cookies.__session)
  ) {
    res.status(403).json({
      message: `No Firebase ID token was passed as a Bearer token in the Authorization header.
      Make sure you authorize your request by providing the following HTTP header:
      Authorization: Bearer <Firebase ID Token> or by passing a "__session" cookie.`
    });
  }

  let idToken;
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer ")
  ) {
    idToken = req.headers.authorization.split("Bearer ")[1];
  } else if (req.cookies) {
    idToken = req.cookies.__session;
  } else {
    res.status(403).json({
      message: "Unauthorized"
    });
  }

  try {
    const decodedIdToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedIdToken;
    next();
    return;
  } catch (error) {
    console.error("Error while verifying Firebase ID token:", error);
    res.status(403).json({
      message: "Unauthorized"
    });
    return;
  }
};

app.use(cors);
app.use(cookieParser);
app.use(express.urlencoded());
app.use(express.json());

app.get("/profile", validateFirebaseIdToken, (req, res) => {
  if (req.method !== "GET") {
    res.status(405).end();
  }
  if (!(req.query && req.query.email)) {
    res.status(500).json({
      message: "Email query string is required."
    });
  }
  db.collection("users")
    .doc(req.query.email)
    .get()
    .then(function(doc) {
      let data = doc.data();
      res.status(200).json({
        message: data
          ? "Successfuly returned user profile data!"
          : "No user data found!",
        hasData: !!data,
        data
      });
    })
    .catch(function(error) {
      res.status(500).json({
        message: `There seems to be an error while returning user profile, please try again latter!`
      });
      console.error(error);
    });
});

app.put("/sign-up", (req, res) => {
  if (req.method !== "PUT") {
    res.status(405).end();
  }
  const busboy = new Busboy({ headers: req.headers });
  const fields = {};
  const uploads = {};

  busboy.on("file", (fieldname, file, filename, encoding, mimetype) => {
    const filepath = path.join(os.tmpdir(), filename);
    if (fieldname) {
      uploads[fieldname] = { file: filepath, type: mimetype };
      file.pipe(fs.createWriteStream(filepath));
    }
  });

  busboy.on("field", (fieldname, val) => {
    if (!fields[fieldname]) {
      fields[fieldname] = val;
    } else {
      if (fields[fieldname] instanceof Array) {
        fields[fieldname] = [...fields[fieldname], JSON.parse(val)];
      } else {
        fields[fieldname] = [JSON.parse(fields[fieldname]), JSON.parse(val)];
      }
    }
  });

  busboy.on("finish", async () => {
    let uploadResults = [];
    if (uploads.profileImage) {
      try {
        uploadResults = await bucket.upload(uploads.profileImage.file, {
          uploadType: "media",
          metadata: {
            metadata: {
              contentType: uploads.profileImage.type
            }
          }
        });
        let [result] = uploadResults;
        fields.photo = `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${result.metadata.name}?alt=media`;
      } catch (error) {
        res.status(500).json({
          message: `There seems to be an error while uploading profile, please try again latter!`
        });
        console.log(error);
      }
    }

    if (!fields.email) {
      res.status(500).json({
        message: "Email field is required."
      });
    }
    if (fields.date_of_birth) {
      fields.date_of_birth = new Date(fields.date_of_birth);
    }
    db.collection("users")
      .doc(fields.email)
      .set(fields)
      .then(function() {
        res.status(200).json({
          message: "Successfuly created user profile!",
          data: fields
        });
      })
      .catch(function(error) {
        res.status(500).json({
          message: `There seems to be an error while creating user profile, please try again latter!`
        });
        console.error(error);
      });
  });
  busboy.end(req.rawBody);
});

exports.app = functions.https.onRequest(app);
