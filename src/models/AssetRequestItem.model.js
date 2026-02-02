import { DataTypes } from "sequelize";
import sequelize from "../config/database.js";

const AssetRequestItem = sequelize.define(
    "AssetRequestItem",
    {
        id: {
            type: DataTypes.CHAR(36),
            primaryKey: true,
            defaultValue: DataTypes.UUIDV4,
        },


        req_id: {
            type: DataTypes.CHAR(36),
            allowNull: false,
        },

        asset_id: {
            type: DataTypes.CHAR(36),
            allowNull: false,
        },

        requested_qty: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },
        spare_item: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        },
        spare_status: {
            type: DataTypes.ENUM(
                "PENDING",
                "REQUESTED",
                "APPROVED",
                "REJECTED"
            ),
            allowNull: false,
            defaultValue: "PENDING",
        },

        spare_remarks: {
            type: DataTypes.TEXT,
            allowNull: true,
        },

        servicing_status: {
            type: DataTypes.ENUM("PENDING", "APPROVED", "REJECTED"),
            allowNull: true,
        },

        servicing_requested_at: {
            type: DataTypes.DATE,
            allowNull: true,
        },

        servicing_reviewed_at: {
            type: DataTypes.DATE,
            allowNull: true,
        },

        servicing_remarks: {
            type: DataTypes.TEXT,
            allowNull: true,
        },

        servicing_outcome: {
            type: DataTypes.ENUM("COMPLETED", "SCRAPPED"),
            allowNull: true,
        },
        servicing_completed_at: {
            type: DataTypes.DATE,
            allowNull: true,
        }




    },
    {
        tableName: "asset_request_items",
        timestamps: false,
        charset: "utf8mb4",
        collate: "utf8mb4_bin",
    }
);

/* ================= ASSOCIATIONS ================= */
AssetRequestItem.associate = (models) => {
    AssetRequestItem.belongsTo(models.Asset, {
        foreignKey: "asset_id",
        as: "asset",
    });

    AssetRequestItem.belongsTo(models.AssetRequest, {
        foreignKey: "req_id",
        as: "request",
    });

    AssetRequestItem.hasMany(models.AssetRequestItemImage, {
        foreignKey: "request_item_id",
        as: "images",
        onDelete: "CASCADE",
    });

    AssetRequestItem.hasMany(models.AssetReturnRequest, {
        foreignKey: "request_item_id",
        as: "returnRequests",
    });


};

export default AssetRequestItem;
