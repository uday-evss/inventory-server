import bcrypt from "bcrypt";
import User from "../models/User.model.js";

export const changePassword = async (req, res, next) => {
    try {

        const userId = req.user.id;
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                message: "Current and new password are required",
            });
        }

        if (newPassword.length < 4) {
            return res.status(400).json({
                message: "Password must be at least 4 characters long",
            });
        }

        const user = await User.findByPk(userId);

        const isMatch = await bcrypt.compare(currentPassword, user.password);

        if (!isMatch) {
            return res.status(401).json({
                field: "currentPassword",
                message: "Current password is incorrect",
            });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await user.update({ password: hashedPassword });

        return res.status(200).json({
            message: "Password updated successfully",
        });
    } catch (error) {
        next(error);
    }
};

