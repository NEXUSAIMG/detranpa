-- AlterTable
ALTER TABLE `Conversa` ADD COLUMN `atendenteId` VARCHAR(30) NULL,
    ADD COLUMN `atendenteNome` VARCHAR(120) NULL,
    ADD COLUMN `transbordoEm` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `Mensagem` ADD COLUMN `autorNome` VARCHAR(120) NULL;

-- CreateIndex
CREATE INDEX `Conversa_tenantId_status_ultimaEm_idx` ON `Conversa`(`tenantId`, `status`, `ultimaEm`);
