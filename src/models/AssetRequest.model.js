import { DataTypes } from "sequelize";
import sequelize from "../config/database.js";

const AssetRequest = sequelize.define(
    "AssetRequest",
    {
        req_id: {
            type: DataTypes.CHAR(36),
            primaryKey: true,
            defaultValue: DataTypes.UUIDV4,
        },


        req_user_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },

        admin_user_id: {
            type: DataTypes.UUID,
            allowNull: true,
        },

        req_nature: {
            type: DataTypes.ENUM("CREATED", "TRANSFERRED"),
            allowNull: false,
            defaultValue: "CREATED",
        },


        admin_approval: {
            type: DataTypes.ENUM("PENDING", "APPROVED", "REJECTED"),
            allowNull: false,
            defaultValue: "PENDING",
        },

        admin_advice: {
            type: DataTypes.TEXT,
            allowNull: true,
        },


        allocated: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: 0,
        },

        priority_level: {
            type: DataTypes.ENUM("HIGH", "MEDIUM", "LOW"),
            allowNull: false,
            defaultValue: "MEDIUM",
        },

        site_id: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
                model: "site_data",
                key: "site_id",
            },
            onDelete: "CASCADE",
        },


        request_remarks: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
    },
    {
        tableName: "asset_request",
        timestamps: true,
        createdAt: "requested_at",
        updatedAt: false,
        charset: "utf8mb4",
        collate: "utf8mb4_bin",
    }
);

/* ================= ASSOCIATIONS ================= */
AssetRequest.associate = (models) => {
    AssetRequest.belongsTo(models.User, {
        foreignKey: "req_user_id",
        as: "requestedBy",
    });

    AssetRequest.belongsTo(models.User, {
        foreignKey: "admin_user_id",
        as: "approvedBy",
    });

    AssetRequest.belongsTo(models.SiteData, {
        foreignKey: "site_id",
        as: "site",
    });


    AssetRequest.hasMany(models.AssetRequestItem, {
        foreignKey: "req_id",
        as: "items",
        onDelete: "CASCADE",
    });
};

export default AssetRequest;
