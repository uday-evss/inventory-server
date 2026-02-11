import bcrypt from "bcrypt";
import crypto from "crypto";
import { s3 } from "../config/s3.js";
import User from "../models/User.model.js";
import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";


//CREATING USER
export const createUser = async (req, res, next) => {
    try {
        const {
            employeeId,
            fullName,
            role,
            email,
            mobile,
            username,
            password,
        } = req.body;

        const existingUser = await User.findOne({
            where: { employeeId },
        });

        if (existingUser) {
            return res.status(400).json({
                message: "Employee already exists",
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        let profilePicUrl = null;

        // ✅ Upload to S3 if file exists
        if (req.file) {
            const fileExt = req.file.originalname.split(".").pop();
            const fileName = `profiles/${crypto.randomUUID()}.${fileExt}`;

            await s3.send(
                new PutObjectCommand({
                    Bucket: process.env.AWS_BUCKET_NAME,
                    Key: fileName,
                    Body: req.file.buffer,
                    ContentType: req.file.mimetype,
                })
            );

            profilePicUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;
        }

        const user = await User.create({
            employeeId,
            fullName,
            role,
            email,
            mobile,
            username,
            password: hashedPassword,
            profilePic: profilePicUrl, // 👈 S3 URL saved
            company_id: req.user.company_id,
        });

        res.status(201).json({
            message: "User created successfully",
            data: user,
        });
    } catch (error) {
        next(error);
    }
};

//UPDATING USER
export const updateUser = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { fullName, role, email, mobile, resetPassword } = req.body;



        // const user = await User.findByPk(id);
        // if (!user) {
        //     return res.status(404).json({ message: "User not found" });
        // }

        const user = await User.findOne({
            where: {
                id,
                company_id: req.user.company_id,
            },
        });

        if (!user) {
            return res.status(404).json({
                message: "User not found or unauthorized",
            });
        }


        if (resetPassword) {
            const hashed = await bcrypt.hash(resetPassword, 12);

            user.password = hashed;
            user.forcePasswordChange = true;
            user.passwordUpdatedAt = new Date();
        }

        let profilePicUrl = user.profilePic;

        /** ================= IMAGE HANDLING ================= */
        if (req.file) {
            /** 1️⃣ Delete old image if exists */
            if (user.profilePic) {
                const oldKey = user.profilePic.split(".amazonaws.com/")[1];

                await s3.send(
                    new DeleteObjectCommand({
                        Bucket: process.env.AWS_BUCKET_NAME,
                        Key: oldKey,
                    })
                );
            }

            /** 2️⃣ Upload new image */
            const ext = req.file.originalname.split(".").pop();
            const key = `profiles/${crypto.randomUUID()}.${ext}`;

            await s3.send(
                new PutObjectCommand({
                    Bucket: process.env.AWS_BUCKET_NAME,
                    Key: key,
                    Body: req.file.buffer,
                    ContentType: req.file.mimetype,
                })
            );

            profilePicUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
        }

        /** ================= UPDATE USER ================= */
        await user.update({
            fullName,
            role,
            email,
            mobile,
            profilePic: profilePicUrl,
        });

        await user.save();


        res.status(200).json({
            message: "User updated successfully",
            data: user,
        });
    } catch (error) {
        next(error);
    }
};


//FETCHING USERS
export const getUsers = async (req, res, next) => {
    try {
        // const users = await User.findAll({
        //     attributes: { exclude: ["password"] },
        //     order: [["createdAt", "DESC"]],
        // });

        const users = await User.findAll({
            where: { company_id: req.user.company_id },
            attributes: { exclude: ["password"] },
            order: [["createdAt", "DESC"]],
        });


        // console.log(users, 'users324')
        res.status(200).json({
            data: users,
        });
    } catch (error) {
        next(error);
    }
};


//DELETING USERS
export const deleteUser = async (req, res, next) => {
    try {
        const { id } = req.params;

        // const user = await User.findByPk(id);
        // if (!user) {
        //     return res.status(404).json({ message: "User not found" });
        // }

        const user = await User.findOne({
            where: {
                id,
                company_id: req.user.company_id,
            },
        });

        if (!user) {
            return res.status(404).json({
                message: "User not found or unauthorized",
            });
        }


        if (user.profilePic) {
            const key = user.profilePic.split(".amazonaws.com/")[1];

            await s3.send(
                new DeleteObjectCommand({
                    Bucket: process.env.AWS_BUCKET_NAME,
                    Key: key,
                })
            );
        }

        await user.destroy();

        res.json({
            message: "User deleted successfully",
        });
    } catch (error) {
        next(error);
    }
};

//FETCHING USER BY ID
export const getUserById = async (req, res) => {
    try {
        const { id } = req.params;

        // const user = await User.findByPk(id, {
        //     attributes: {
        //         exclude: ["password"]
        //     }
        // });

        // if (!user) {
        //     return res.status(404).json({ message: "User not found" });
        // }

        const user = await User.findOne({
            where: {
                id,
                company_id: req.user.company_id,
            },
            attributes: { exclude: ["password"] },
        });

        if (!user) {
            return res.status(404).json({
                message: "User not found or access denied",
            });
        }


        res.json(user);
    } catch (err) {
        res.status(500).json({ message: "Failed to fetch user" });
    }
};
