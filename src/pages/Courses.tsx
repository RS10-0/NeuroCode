import { Link } from "react-router-dom";

function Courses() {
  return (
    <div className="courses-page">
      <header className="dashboard-header">
        <Link to="/" className="logo">
          NeuroCode
        </Link>

        <nav>
          <Link to="/dashboard">Dashboard</Link>
          <Link to="/profile">Profile</Link>
        </nav>
      </header>

      <main className="courses-content">
        <section className="courses-intro">
          <p className="eyebrow">LEARNING PATHS</p>

          <h1>Choose what you want to learn.</h1>

          <p>
            Start with the fundamentals, build your skills, and work toward
            solving real problems.
          </p>
        </section>

        <section className="course-list">
          <div className="full-course-card">
            <div>
              <span className="course-language">JAVA</span>

              <h2>Java Fundamentals</h2>

              <p>
                A beginner-friendly path covering variables, data types,
                conditionals, loops, methods, arrays, and object-oriented
                programming.
              </p>

              <div className="course-meta">
                <span>12 lessons</span>
                <span>Beginner</span>
              </div>
            </div>

            <Link to="/learn" className="primary-button">
              Start Course
            </Link>
          </div>

          <div className="full-course-card disabled-course">
            <div>
              <span className="course-language">PYTHON</span>

              <h2>Python Fundamentals</h2>

              <p>
                Learn Python syntax, control flow, functions, data structures,
                and problem solving.
              </p>

              <div className="course-meta">
                <span>Coming soon</span>
              </div>
            </div>

            <button disabled className="secondary-button">
              Coming Soon
            </button>
          </div>

          <div className="full-course-card disabled-course">
            <div>
              <span className="course-language">JAVASCRIPT</span>

              <h2>JavaScript Fundamentals</h2>

              <p>
                Learn the fundamentals of JavaScript and prepare to build
                interactive web applications.
              </p>

              <div className="course-meta">
                <span>Coming soon</span>
              </div>
            </div>

            <button disabled className="secondary-button">
              Coming Soon
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}

export default Courses;