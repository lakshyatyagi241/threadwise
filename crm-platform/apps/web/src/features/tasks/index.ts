/** Public surface of the tasks domain. Other domains import from here, never from the folders below. */
export { LinkedTasks, type LinkedTasksProps } from './components/linked-tasks';
export { TasksScreen } from './components/tasks-screen';
/** The deal timeline mirrors its tasks into this list (D-14): its writers refresh the lists and the badges through this. */
export { invalidateTasks } from './api/hooks';
