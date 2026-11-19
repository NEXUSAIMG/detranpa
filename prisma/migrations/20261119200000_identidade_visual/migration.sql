-- AlterTable
ALTER TABLE `Tenant` ADD COLUMN `corDestaque` VARCHAR(9) NULL,
    ADD COLUMN `demonstracao` BOOLEAN NOT NULL DEFAULT true;

-- O DETRAN-PA já estava no ar antes do multi-tenant: continua como canal normal.
UPDATE `Tenant` SET `demonstracao` = false WHERE `slug` = 'pa';

-- CreateTable
CREATE TABLE `TenantArquivo` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `tipo` VARCHAR(20) NOT NULL,
    `mime` VARCHAR(40) NOT NULL,
    `dados` MEDIUMBLOB NOT NULL,
    `atualizadoEm` DATETIME(3) NOT NULL,

    UNIQUE INDEX `TenantArquivo_tenantId_tipo_key`(`tenantId`, `tipo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `TenantArquivo` ADD CONSTRAINT `TenantArquivo_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
