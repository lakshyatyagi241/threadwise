/** Public surface of the tasks domain. Other domains import from here, never from the folders below. */
export { LinkedTasks, type LinkedTasksProps } from './components/linked-tasks';
export { TasksScreen } from './components/tasks-screen';
/** The deal timeline mirrors its tasks into this list (D-14): its writers refresh the lists and the badges through this. */
export { invalidateTasks } from './api/hooks';
/** "New task" from another screen (the contact quick view's Task action): pre-linked through `link`; mount it only while it is open. */
export { TaskFormModal, type TaskFormModalProps } from './components/task-form-modal';
export type { RecordRef } from './api/schemas';
