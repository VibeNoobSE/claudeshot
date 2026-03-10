registerGame("maze-race", "🏁 Maze Race", "WASD = P1, Arrows = P2", "Race through the maze to the exit!", class extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor("#1a1a2e");
    this.walls=this.physics.add.staticGroup();
    const gs=40;
    // Generate simple maze walls
    const maze=[
      [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
      [1,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,1],
      [1,0,1,0,1,0,1,1,1,0,1,0,1,0,1,1,1,1,0,1],
      [1,0,1,0,0,0,0,0,1,0,1,0,0,0,0,0,0,1,0,1],
      [1,0,1,1,1,1,1,0,1,0,1,1,1,1,1,0,0,0,0,1],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,1,1,0,1],
      [1,0,1,1,0,1,1,1,1,1,1,1,0,0,0,0,0,0,0,1],
      [1,0,0,1,0,0,0,0,0,0,0,1,0,1,1,1,1,0,1,1],
      [1,1,0,1,0,1,0,1,1,1,0,1,0,0,0,0,0,0,0,1],
      [1,0,0,0,0,1,0,0,0,1,0,0,0,1,1,0,1,1,0,1],
      [1,0,1,1,1,1,1,1,0,1,1,1,0,0,0,0,0,0,0,1],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,1,0,2,1],
      [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]];
    let exitX=0,exitY=0;
    for(let r=0;r<maze.length;r++)for(let c=0;c<maze[r].length;c++){
      if(maze[r][c]===1)this.walls.add(this.add.rectangle(c*gs+gs/2,r*gs+gs/2,gs,gs,0x333355));
      if(maze[r][c]===2){exitX=c*gs+gs/2;exitY=r*gs+gs/2;}
    }
    this.exit=this.add.rectangle(exitX,exitY,gs-4,gs-4,0x4ecca3);
    this.p1=this.add.circle(gs*1.5,gs*1.5,10,0xf7c948);this.p2=this.add.circle(gs*1.5,gs*2.5,10,0xe94560);
    [this.p1,this.p2].forEach(p=>{this.physics.add.existing(p);p.body.setCollideWorldBounds(true);});
    this.physics.add.collider(this.p1,this.walls);this.physics.add.collider(this.p2,this.walls);
    this.k=this.input.keyboard.addKeys({w:"W",a:"A",s:"S",d:"D",up:"UP",down:"DOWN",left:"LEFT",right:"RIGHT"});
    this.over=false;
  }
  update(){if(this.over)return;const s=180,k=this.k;
    this.p1.body.setVelocity(k.a.isDown?-s:k.d.isDown?s:0,k.w.isDown?-s:k.s.isDown?s:0);
    this.p2.body.setVelocity(k.left.isDown?-s:k.right.isDown?s:0,k.up.isDown?-s:k.down.isDown?s:0);
    if(Phaser.Math.Distance.Between(this.p1.x,this.p1.y,this.exit.x,this.exit.y)<20){this.over=true;this.add.text(W/2,H/2-40,"P1 WINS!",{fontSize:"36px",color:"#f7c948",fontFamily:"monospace"}).setOrigin(0.5);}
    if(Phaser.Math.Distance.Between(this.p2.x,this.p2.y,this.exit.x,this.exit.y)<20){this.over=true;this.add.text(W/2,H/2-40,"P2 WINS!",{fontSize:"36px",color:"#e94560",fontFamily:"monospace"}).setOrigin(0.5);}
  }
});
