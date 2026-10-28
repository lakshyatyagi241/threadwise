import { redirect } from 'next/navigation';

/** Demo booking was retired in favour of signing up; old links go to the sign-up page. */
export default function Page() {
  redirect('/register');
}
