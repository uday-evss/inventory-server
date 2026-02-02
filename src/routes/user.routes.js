import express from "express";
import { createUser, getUsers, updateUser, deleteUser, getUserById } from "../controllers/user.controller.js";
import { upload } from "../middlewares/upload.middleware.js";
import { authenticate } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.post("/create-user", authenticate, upload.single("profilePic"), createUser);
router.put(
    "/update-user/:id",
    authenticate,
    upload.single("profilePic"),
    updateUser
);
router.delete("/delete-user/:id", authenticate, deleteUser);
router.get("/get-users", authenticate, getUsers);
router.get("/get-user/:id", getUserById);


export default router;
