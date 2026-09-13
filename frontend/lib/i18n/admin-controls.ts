/**
 * Internationalization strings for Admin Emergency Controls
 * Supports EN (English) and ES (Spanish)
 */

export type Locale = 'en' | 'es'

export const adminControlsStrings = {
  en: {
    // Alert titles and descriptions
    poolPaused: 'Pool Paused',
    poolPausedDescription: 'This pool is currently paused by the admin. No deposits or payouts can be processed.',
    adminEmergencyControls: 'Admin Emergency Controls',
    adminControlsDescription: 'As the pool admin, you have access to emergency controls. These actions are logged and require wallet signature verification.',
    
    // Button labels
    pausePool: 'Pause Pool',
    resumePool: 'Resume Pool',
    emergencyWithdraw: 'Emergency Withdraw',
    cancel: 'Cancel',
    confirm: 'Confirm',
    
    // Dialog titles
    pausePoolTitle: 'Pause Pool',
    resumePoolTitle: 'Resume Pool',
    emergencyWithdrawTitle: 'Emergency Withdrawal',
    
    // Dialog descriptions
    pausePoolDesc: 'Pausing the pool will prevent all deposits and payouts. This action can be reversed.',
    resumePoolDesc: 'Resuming the pool will allow deposits and payouts to continue normally.',
    emergencyWithdrawDesc: 'This will withdraw ALL funds from the pool and mark it as inactive. This action is IRREVERSIBLE.',
    
    // Form labels
    pauseReason: 'Reason for Pausing',
    pauseReasonPlaceholder: 'Enter the reason for pausing this pool...',
    pauseReasonRequired: 'Reason Required',
    pauseReasonRequiredDesc: 'Please provide a reason for pausing the pool.',
    recipientAddress: 'Recipient Address',
    recipientAddressDesc: 'The Stellar address that will receive all pool funds',
    recipientRequired: 'Recipient Required',
    recipientRequiredDesc: 'Please provide a recipient address.',
    
    // Warnings
    signatureRequired: 'Your wallet will be asked to sign a message to verify this action.',
    emergencyWarningTitle: 'Warning',
    emergencyWarnings: [
      'All funds will be transferred to the recipient address',
      'The pool will be marked as inactive permanently',
      'This action CANNOT be undone',
      'Use only in case of critical contract malfunction',
    ],
    
    // Loading states
    pausing: 'Pausing...',
    resuming: 'Resuming...',
    processing: 'Processing...',
    
    // Success messages
    poolPausedSuccess: 'Pool Paused',
    poolPausedSuccessDesc: 'The pool has been paused successfully.',
    poolResumedSuccess: 'Pool Resumed',
    poolResumedSuccessDesc: 'The pool has been resumed successfully.',
    emergencyWithdrawSuccess: 'Emergency Withdrawal Complete',
    emergencyWithdrawSuccessDesc: (recipient: string) => `All funds have been transferred to ${recipient}`,
    
    // Error messages
    pauseFailed: 'Pause Failed',
    unpauseFailed: 'Unpause Failed',
    emergencyWithdrawFailed: 'Emergency Withdrawal Failed',
    unknownError: 'Unknown error',
  },
  
  es: {
    // Alert titles and descriptions
    poolPaused: 'Grupo Pausado',
    poolPausedDescription: 'Este grupo está actualmente pausado por el administrador. No se pueden procesar depósitos ni pagos.',
    adminEmergencyControls: 'Controles de Emergencia del Administrador',
    adminControlsDescription: 'Como administrador del grupo, tienes acceso a controles de emergencia. Estas acciones se registran y requieren verificación de firma de billetera.',
    
    // Button labels
    pausePool: 'Pausar Grupo',
    resumePool: 'Reanudar Grupo',
    emergencyWithdraw: 'Retiro de Emergencia',
    cancel: 'Cancelar',
    confirm: 'Confirmar',
    
    // Dialog titles
    pausePoolTitle: 'Pausar Grupo',
    resumePoolTitle: 'Reanudar Grupo',
    emergencyWithdrawTitle: 'Retiro de Emergencia',
    
    // Dialog descriptions
    pausePoolDesc: 'Pausar el grupo evitará todos los depósitos y pagos. Esta acción se puede revertir.',
    resumePoolDesc: 'Reanudar el grupo permitirá que los depósitos y pagos continúen normalmente.',
    emergencyWithdrawDesc: 'Esto retirará TODOS los fondos del grupo y lo marcará como inactivo. Esta acción es IRREVERSIBLE.',
    
    // Form labels
    pauseReason: 'Razón para Pausar',
    pauseReasonPlaceholder: 'Ingrese la razón para pausar este grupo...',
    pauseReasonRequired: 'Razón Requerida',
    pauseReasonRequiredDesc: 'Por favor proporcione una razón para pausar el grupo.',
    recipientAddress: 'Dirección del Destinatario',
    recipientAddressDesc: 'La dirección de Stellar que recibirá todos los fondos del grupo',
    recipientRequired: 'Destinatario Requerido',
    recipientRequiredDesc: 'Por favor proporcione una dirección de destinatario.',
    
    // Warnings
    signatureRequired: 'Se le pedirá a su billetera que firme un mensaje para verificar esta acción.',
    emergencyWarningTitle: 'Advertencia',
    emergencyWarnings: [
      'Todos los fondos serán transferidos a la dirección del destinatario',
      'El grupo se marcará como inactivo permanentemente',
      'Esta acción NO SE PUEDE deshacer',
      'Usar solo en caso de mal funcionamiento crítico del contrato',
    ],
    
    // Loading states
    pausing: 'Pausando...',
    resuming: 'Reanudando...',
    processing: 'Procesando...',
    
    // Success messages
    poolPausedSuccess: 'Grupo Pausado',
    poolPausedSuccessDesc: 'El grupo ha sido pausado exitosamente.',
    poolResumedSuccess: 'Grupo Reanudado',
    poolResumedSuccessDesc: 'El grupo ha sido reanudado exitosamente.',
    emergencyWithdrawSuccess: 'Retiro de Emergencia Completado',
    emergencyWithdrawSuccessDesc: (recipient: string) => `Todos los fondos han sido transferidos a ${recipient}`,
    
    // Error messages
    pauseFailed: 'Pausa Fallida',
    unpauseFailed: 'Reanudación Fallida',
    emergencyWithdrawFailed: 'Retiro de Emergencia Fallido',
    unknownError: 'Error desconocido',
  },
}

/**
 * Get strings for a specific locale
 */
export function getAdminControlsStrings(locale: Locale = 'en') {
  return adminControlsStrings[locale]
}
