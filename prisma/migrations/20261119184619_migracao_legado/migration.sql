-- CreateTable
CREATE TABLE `MigracaoLegado` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `etapa` VARCHAR(40) NOT NULL,
    `total` INTEGER NOT NULL DEFAULT 0,
    `detalhe` TEXT NULL,
    `executadaEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `MigracaoLegado_tenantId_etapa_key`(`tenantId`, `etapa`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `MigracaoLegado` ADD CONSTRAINT `MigracaoLegado_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
