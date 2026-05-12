const express = require("express");
const ctrl = require("../controllers/auth.controller");
const { verifyFirebaseIdToken, attachRegisteredUser } = require("../middleware/firebaseAuth");

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get("/me", verifyFirebaseIdToken, attachRegisteredUser, wrap(ctrl.getMe));
router.post("/invite", verifyFirebaseIdToken, attachRegisteredUser, wrap(ctrl.postInvite));
router.get("/users", verifyFirebaseIdToken, attachRegisteredUser, wrap(ctrl.listUsers));
router.get("/property-options", verifyFirebaseIdToken, attachRegisteredUser, wrap(ctrl.listPropertyOptions));
router.patch("/users/:uid", verifyFirebaseIdToken, attachRegisteredUser, wrap(ctrl.patchUser));

module.exports = router;
