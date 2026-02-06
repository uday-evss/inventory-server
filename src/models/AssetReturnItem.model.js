import { DataTypes } from "sequelize";
import sequelize from "../config/database.js";

const AssetReturnItem = sequelize.define(
    "AssetReturnItem",
    {
        id: {
            type: DataTypes.CHAR(36),
            primaryKey: true,
            defaultValue: DataTypes.UUIDV4,
        },

        return_id: {
            type: DataTypes.CHAR(36),
            allowNull: false,
        },

        asset_id: {
            type: DataTypes.CHAR(36),
            allowNull: false,
        },

        return_qty: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },
        spare_check: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        },

    },
    {
        tableName: "asset_return_items",
        timestamps: false,
        charset: "utf8mb4",
        collate: "utf8mb4_bin",
    }
);

AssetReturnItem.associate = (models) => {
    AssetReturnItem.hasMany(models.AssetReturnImage, {
        foreignKey: "return_item_id",
        as: "images",
    });

    AssetReturnItem.belongsTo(models.Asset, {
        foreignKey: "asset_id",
        as: "asset",
    });

    AssetReturnItem.belongsTo(models.AssetReturnRequest, {
        foreignKey: "return_id",
        as: "returnRequest",
    });


}

export default AssetReturnItem;