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
            // unique: true,
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

        company_id: {
            type: DataTypes.CHAR(36),
            allowNull: false,
        }
    },
    {
        tableName: "users",
        timestamps: true,
        indexes: [
            { unique: true, fields: ["employeeId", "company_id"] },
            { unique: true, fields: ["email", "company_id"] },
            { unique: true, fields: ["username", "company_id"] },
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

    User.belongsTo(models.Company, {
        foreignKey: "company_id",
        as: "company",
    });



}

export default User;
