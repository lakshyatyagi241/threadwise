/** Public surface of the tasks domain. Other domains import from here, never from the folders below. */
export { LinkedTasks, type LinkedTasksProps } from './components/linked-tasks';
export { TasksScreen } from './components/tasks-screen';
/** The deal timeline mirrors its tasks into this list (D-14): its writers refresh the lists and the badges through this. */
export { invalidateTasks } from './api/hooks';
/** "New task" from another screen (the contact quick view's Task action): pre-linked through `link`; mount it only while it is open. */
export { TaskFormModal, type TaskFormModalProps } from './components/task-form-modal';
export type { RecordRef } from './api/schemas';
/**
 * The contact page's timeline and its compose box: the inline "Add task" row, the tick of a task and the record's task list, so the
 * contact screens show and add tasks in place without opening the New task form.
 */
export { InlineTaskAdd } from './components/inline-task-add';
export { TaskCompleteCheck } from './components/task-check';
export { useTasksList } from './api/hooks';
export { useTasksCan } from './components/parts';
export type { TaskSource } from './api/service';
