import { DataTypes } from "sequelize";
import sequelize from "../config/database.js";

const User = sequelize.define(
    "User",
    {
        id: {
            type: DataTypes.CHAR(36),
            primaryKey: true,
            defaultValue: DataTypes.UUIDV4,
        },

        employeeId: {
            type: DataTypes.STRING,
            allowNull: false,
        },

        fullName: {
            type: DataTypes.STRING,
            allowNull: false,
        },

        role: {
            type: DataTypes.STRING,
            allowNull: false,
        },

        email: {
            type: DataTypes.STRING,
            allowNull: false,
        },

        mobile: {
            type: DataTypes.STRING,
            allowNull: false,
        },

        username: {
            type: DataTypes.STRING,
            allowNull: false,
        },

        password: {
            type: DataTypes.STRING,
            allowNull: false,
        },

        forcePasswordChange: {
            type: DataTypes.BOOLEAN,
            defaultValue: true,
        },

        passwordUpdatedAt: {
            type: DataTypes.DATE,
            allowNull: true,
        },


        profilePic: {
            type: DataTypes.STRING,
            allowNull: true,
        },
    },
    {
        tableName: "users",
        timestamps: true,
        indexes: [
            { unique: true, fields: ["employeeId"] },
            { unique: true, fields: ["email"] },
            { unique: true, fields: ["username"] },
        ],
        charset: "utf8mb4",
        collate: "utf8mb4_bin",
    }
);

User.associate = (models) => {
    User.hasMany(models.AssetRequest, {
        foreignKey: "req_user_id",
        as: "assetRequests",
    });
    User.hasMany(models.AssetReturnRequest, {
        foreignKey: "initiated_by",
        as: "assetReturns",
    });


}

export default User;
