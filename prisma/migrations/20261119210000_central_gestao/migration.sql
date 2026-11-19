-- Central de Gestão: chamados com protocolo, fichas de cidadão, respostas rápidas,
-- etiquetas, status do atendente e indicadores de atendimento.
-- Nomes de tabela com maiúscula: o MySQL do Railway (Linux) diferencia.
-- AlterTable
ALTER TABLE `conversa` ADD COLUMN `avaliacao` INTEGER NULL,
    ADD COLUMN `avaliacaoPendente` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `encerradaEm` DATETIME(3) NULL,
    ADD COLUMN `primeiraRespostaEm` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `tenant` ADD COLUMN `configGestao` JSON NULL,
    ADD COLUMN `protocoloSeq` INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `usuario` ADD COLUMN `statusAtendimento` VARCHAR(12) NOT NULL DEFAULT 'OFFLINE',
    ADD COLUMN `statusEm` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `Chamado` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `numero` INTEGER NOT NULL,
    `protocolo` VARCHAR(30) NOT NULL,
    `conversaId` VARCHAR(30) NULL,
    `canal` ENUM('WEB', 'WHATSAPP') NULL,
    `contato` VARCHAR(80) NULL,
    `nome` VARCHAR(120) NULL,
    `assunto` VARCHAR(160) NOT NULL,
    `descricao` TEXT NULL,
    `categoria` VARCHAR(60) NULL,
    `prioridade` VARCHAR(10) NOT NULL DEFAULT 'NORMAL',
    `status` VARCHAR(20) NOT NULL DEFAULT 'ABERTO',
    `responsavelId` VARCHAR(30) NULL,
    `responsavelNome` VARCHAR(120) NULL,
    `prazoEm` DATETIME(3) NULL,
    `avisarCidadao` BOOLEAN NOT NULL DEFAULT true,
    `criadoPorNome` VARCHAR(120) NULL,
    `criadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `atualizadoEm` DATETIME(3) NOT NULL,
    `resolvidoEm` DATETIME(3) NULL,

    INDEX `Chamado_tenantId_status_atualizadoEm_idx`(`tenantId`, `status`, `atualizadoEm`),
    INDEX `Chamado_tenantId_contato_idx`(`tenantId`, `contato`),
    UNIQUE INDEX `Chamado_tenantId_numero_key`(`tenantId`, `numero`),
    UNIQUE INDEX `Chamado_tenantId_protocolo_key`(`tenantId`, `protocolo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ChamadoEvento` (
    `id` VARCHAR(191) NOT NULL,
    `chamadoId` VARCHAR(191) NOT NULL,
    `tipo` VARCHAR(20) NOT NULL,
    `autorNome` VARCHAR(120) NULL,
    `texto` TEXT NOT NULL,
    `publico` BOOLEAN NOT NULL DEFAULT false,
    `criadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ChamadoEvento_chamadoId_criadoEm_idx`(`chamadoId`, `criadoEm`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Contato` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `contato` VARCHAR(80) NOT NULL,
    `nome` VARCHAR(120) NULL,
    `notas` TEXT NULL,
    `etiquetas` JSON NULL,
    `criadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `atualizadoEm` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Contato_tenantId_contato_key`(`tenantId`, `contato`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RespostaRapida` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `atalho` VARCHAR(40) NOT NULL,
    `titulo` VARCHAR(120) NOT NULL,
    `texto` TEXT NOT NULL,
    `ordem` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `RespostaRapida_tenantId_atalho_key`(`tenantId`, `atalho`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Etiqueta` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `nome` VARCHAR(40) NOT NULL,
    `cor` VARCHAR(9) NOT NULL,

    UNIQUE INDEX `Etiqueta_tenantId_nome_key`(`tenantId`, `nome`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Chamado` ADD CONSTRAINT `Chamado_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ChamadoEvento` ADD CONSTRAINT `ChamadoEvento_chamadoId_fkey` FOREIGN KEY (`chamadoId`) REFERENCES `Chamado`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Contato` ADD CONSTRAINT `Contato_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RespostaRapida` ADD CONSTRAINT `RespostaRapida_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Etiqueta` ADD CONSTRAINT `Etiqueta_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
